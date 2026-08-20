// Package repo provides the User service's canonical authorization reader.
package repo

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/aethercode/aethercode/services/user/internal/app"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres queries the canonical User authorization tables through the
// dedicated aether_user_authz_reader database principal.
type Postgres struct {
	pool *pgxpool.Pool
}

func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool}
}

func (repository *Postgres) Ping(contextValue context.Context) error {
	if err := repository.pool.Ping(contextValue); err != nil {
		return fmt.Errorf("ping User authorization database: %w", err)
	}
	return nil
}

// Snapshot reads all state required for exactly one authorization decision in
// one read-only transaction. It is intentionally not cached across requests:
// a committed role or membership revocation must be visible immediately.
func (repository *Postgres) Snapshot(contextValue context.Context, query app.SnapshotQuery) (app.Snapshot, error) {
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return app.Snapshot{}, fmt.Errorf("begin authorization snapshot: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()

	snapshot := app.Snapshot{
		TargetStudentPlacementScopes: make(map[string]struct{}),
		PlacementStaffScopes:         make(map[string]struct{}),
		OwnedCandidateAssignments:    make(map[string]struct{}),
	}
	if err := transaction.QueryRow(contextValue, `
		SELECT revision
		FROM users.authz_revisions
		WHERE principal_id = $1
	`, query.PrincipalID).Scan(&snapshot.Revision); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			if commitErr := transaction.Commit(contextValue); commitErr != nil {
				return app.Snapshot{}, fmt.Errorf("commit empty authorization snapshot: %w", commitErr)
			}
			return snapshot, nil
		}
		return app.Snapshot{}, fmt.Errorf("read authorization revision: %w", err)
	}

	assignments, err := transaction.Query(contextValue, `
		SELECT role_name, scope_kind, COALESCE(tenant_id::text, ''), COALESCE(scope_id::text, '')
		FROM users.active_role_assignments
		WHERE principal_id = $1
		ORDER BY role_name, scope_kind, tenant_id NULLS FIRST, scope_id NULLS FIRST
	`, query.PrincipalID)
	if err != nil {
		return app.Snapshot{}, fmt.Errorf("read active role assignments: %w", err)
	}
	for assignments.Next() {
		var assignment app.Assignment
		if err := assignments.Scan(&assignment.Role, &assignment.ScopeKind, &assignment.TenantID, &assignment.ScopeID); err != nil {
			assignments.Close()
			return app.Snapshot{}, fmt.Errorf("scan active role assignment: %w", err)
		}
		snapshot.Assignments = append(snapshot.Assignments, assignment)
	}
	if err := assignments.Err(); err != nil {
		assignments.Close()
		return app.Snapshot{}, fmt.Errorf("iterate active role assignments: %w", err)
	}
	assignments.Close()

	staffScopes, err := transaction.Query(contextValue, `
		SELECT placement_department_id::text
		FROM users.placement_department_memberships
		WHERE principal_id = $1
		  AND status = 'active'
		  AND (expires_at IS NULL OR expires_at > clock_timestamp())
	`, query.PrincipalID)
	if err != nil {
		return app.Snapshot{}, fmt.Errorf("read active placement staff memberships: %w", err)
	}
	for staffScopes.Next() {
		var departmentID string
		if err := staffScopes.Scan(&departmentID); err != nil {
			staffScopes.Close()
			return app.Snapshot{}, fmt.Errorf("scan active placement staff membership: %w", err)
		}
		snapshot.PlacementStaffScopes[departmentID] = struct{}{}
	}
	if err := staffScopes.Err(); err != nil {
		staffScopes.Close()
		return app.Snapshot{}, fmt.Errorf("iterate active placement staff memberships: %w", err)
	}
	staffScopes.Close()

	rules, err := transaction.Query(contextValue, `
		SELECT ptype, v0, v1, v2, v3
		FROM users.authorization_policy_rules
		WHERE status = 'active'
		ORDER BY ptype, v0, v1, v2, v3
	`)
	if err != nil {
		return app.Snapshot{}, fmt.Errorf("read canonical Casbin policy rules: %w", err)
	}
	for rules.Next() {
		var rule centralauthz.PolicyRule
		var values [4]*string
		if err := rules.Scan(&rule.PType, &values[0], &values[1], &values[2], &values[3]); err != nil {
			rules.Close()
			return app.Snapshot{}, fmt.Errorf("scan canonical Casbin policy rule: %w", err)
		}
		rule.Values = make([]string, len(values))
		for index, value := range values {
			if value == nil {
				rules.Close()
				return app.Snapshot{}, fmt.Errorf("canonical Casbin policy rule %q has fewer than four values", rule.PType)
			}
			rule.Values[index] = *value
		}
		snapshot.PolicyRules = append(snapshot.PolicyRules, rule)
	}
	if err := rules.Err(); err != nil {
		rules.Close()
		return app.Snapshot{}, fmt.Errorf("iterate canonical Casbin policy rules: %w", err)
	}
	rules.Close()

	if (query.ResourceType == "students" || query.ResourceType == "student_batch_affiliations") && query.TenantID != "" {
		placementScopes, queryErr := transaction.Query(contextValue, `
			SELECT membership.department_id::text
			FROM users.student_department_memberships AS membership
			JOIN users.students AS student ON student.id = membership.student_id
			WHERE student.id = $1
			  AND membership.tenant_id = $2
			  AND membership.department_type = 'placement'
			  AND membership.status = 'active'
		`, query.ResourceID, query.TenantID)
		if queryErr != nil {
			return app.Snapshot{}, fmt.Errorf("read placement scope relationship: %w", queryErr)
		}
		for placementScopes.Next() {
			var departmentID string
			if err := placementScopes.Scan(&departmentID); err != nil {
				placementScopes.Close()
				return app.Snapshot{}, fmt.Errorf("scan placement scope relationship: %w", err)
			}
			snapshot.TargetStudentPlacementScopes[departmentID] = struct{}{}
		}
		if err := placementScopes.Err(); err != nil {
			placementScopes.Close()
			return app.Snapshot{}, fmt.Errorf("iterate placement scope relationships: %w", err)
		}
		placementScopes.Close()
	}

	if query.ResourceType == "candidate_assignments" && query.TenantID != "" {
		var candidateAssignmentID string
		err := transaction.QueryRow(contextValue, `
		SELECT candidate_assignment_id::text
			FROM users.candidate_assignment_projections
			WHERE candidate_assignment_id = $1
			  AND tenant_id = $2
			  AND candidate_id = $3
			  AND lifecycle_state = 'active'
		`, query.ResourceID, query.TenantID, query.PrincipalID).Scan(&candidateAssignmentID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return app.Snapshot{}, fmt.Errorf("read candidate assignment ownership: %w", err)
		}
		if err == nil {
			snapshot.OwnedCandidateAssignments[candidateAssignmentID] = struct{}{}
		}
	}

	if err := transaction.Commit(contextValue); err != nil {
		return app.Snapshot{}, fmt.Errorf("commit authorization snapshot: %w", err)
	}
	return snapshot, nil
}

// UpsertProfile creates or edits the caller-visible profile within the
// transaction-scoped RLS context supplied by the application service.
func (repository *Postgres) UpsertProfile(contextValue context.Context, transaction pgx.Tx, command app.UpsertProfile) (app.Profile, error) {
	var profile app.Profile
	err := transaction.QueryRow(contextValue, `
		INSERT INTO users.profiles (principal_id, given_name, family_name, preferred_name)
		VALUES ($1, $2, $3, NULLIF($4, ''))
		ON CONFLICT (principal_id) DO UPDATE
		SET given_name = EXCLUDED.given_name,
			family_name = EXCLUDED.family_name,
			preferred_name = EXCLUDED.preferred_name,
			version = users.profiles.version + 1
		RETURNING principal_id::text, given_name, family_name,
		          COALESCE(preferred_name, ''), version, created_at, updated_at
	`, command.PrincipalID, command.GivenName, command.FamilyName, command.PreferredName).Scan(
		&profile.PrincipalID, &profile.GivenName, &profile.FamilyName, &profile.PreferredName,
		&profile.Version, &profile.CreatedAt, &profile.UpdatedAt,
	)
	if err != nil {
		return app.Profile{}, mapWriteError(err, "profile could not be saved")
	}
	payload, err := json.Marshal(struct {
		PrincipalID string `json:"principal_id"`
		Version     int    `json:"version"`
	}{PrincipalID: profile.PrincipalID, Version: profile.Version})
	if err != nil {
		return app.Profile{}, fmt.Errorf("encode profile event: %w", err)
	}
	if err := repository.enqueue(contextValue, transaction, "profile", profile.PrincipalID, "", "user.profile.upserted.v1", payload); err != nil {
		return app.Profile{}, err
	}
	return profile, nil
}

// EnrollStudent invokes the narrow owner-owned aggregate command installed by
// migration 000004. It is the only path that can create a current affiliation
// bundle and its companion student self role under one capability.
func (repository *Postgres) EnrollStudent(contextValue context.Context, transaction pgx.Tx, command app.EnrollStudent) (app.Student, error) {
	var student app.Student
	err := transaction.QueryRow(contextValue, `
		SELECT id::text, principal_id::text, tenant_id::text, enrollment_number,
		       status, version, created_at
		FROM users.enroll_student_with_affiliations(
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10
		)
	`, command.ID, command.PrincipalID, command.TenantID, command.EnrollmentNumber,
		command.CollegeDepartmentID, command.PlacementDepartmentID,
		command.CollegeMembershipID, command.PlacementMembershipID,
		command.GrantedStudentRoleID, command.CreatedByPrincipalID).Scan(
		&student.ID, &student.PrincipalID, &student.TenantID, &student.EnrollmentNumber,
		&student.Status, &student.Version, &student.CreatedAt,
	)
	if err != nil {
		return app.Student{}, mapWriteError(err, "student enrollment could not be completed")
	}
	student.CollegeDepartmentID = command.CollegeDepartmentID
	student.PlacementDepartmentID = command.PlacementDepartmentID
	payload, err := json.Marshal(struct {
		StudentID             string `json:"student_id"`
		PrincipalID           string `json:"principal_id"`
		TenantID              string `json:"tenant_id"`
		CollegeDepartmentID   string `json:"college_department_id"`
		PlacementDepartmentID string `json:"placement_department_id"`
	}{
		StudentID: student.ID, PrincipalID: student.PrincipalID, TenantID: student.TenantID,
		CollegeDepartmentID: student.CollegeDepartmentID, PlacementDepartmentID: student.PlacementDepartmentID,
	})
	if err != nil {
		return app.Student{}, fmt.Errorf("encode student enrollment event: %w", err)
	}
	if err := repository.enqueue(contextValue, transaction, "student", student.ID, student.TenantID, "user.student.enrolled.v1", payload); err != nil {
		return app.Student{}, err
	}
	return student, nil
}

func (repository *Postgres) AssignRole(contextValue context.Context, transaction pgx.Tx, command app.AssignRole) (app.RoleAssignment, error) {
	if err := repository.validateRoleScope(contextValue, transaction, command); err != nil {
		return app.RoleAssignment{}, err
	}
	var assignment app.RoleAssignment
	err := transaction.QueryRow(contextValue, `
		INSERT INTO users.role_assignments (
			id, principal_id, role_name, scope_kind, tenant_id, scope_id,
			status, granted_by_principal_id, expires_at
		) VALUES (
			$1, $2, $3, $4, NULLIF($5, '')::uuid, NULLIF($6, '')::uuid,
			'active', $7, $8
		)
		RETURNING id::text, principal_id::text, role_name, scope_kind,
		          COALESCE(tenant_id::text, ''), COALESCE(scope_id::text, ''),
		          status, expires_at, version, created_at
	`, command.ID, command.PrincipalID, command.RoleName, command.ScopeKind,
		command.TenantID, command.ScopeID, command.GrantedByPrincipalID, command.ExpiresAt).Scan(
		&assignment.ID, &assignment.PrincipalID, &assignment.RoleName, &assignment.ScopeKind,
		&assignment.TenantID, &assignment.ScopeID, &assignment.Status, &assignment.ExpiresAt, &assignment.Version,
		&assignment.CreatedAt,
	)
	if err != nil {
		return app.RoleAssignment{}, mapWriteError(err, "role assignment could not be created")
	}
	if err := repository.enqueueRoleEvent(contextValue, transaction, assignment, "user.role.assigned.v1"); err != nil {
		return app.RoleAssignment{}, err
	}
	return assignment, nil
}

func (repository *Postgres) RevokeRole(contextValue context.Context, transaction pgx.Tx, command app.RevokeRole) (app.RoleAssignment, error) {
	var assignment app.RoleAssignment
	err := transaction.QueryRow(contextValue, `
		UPDATE users.role_assignments
		SET status = 'revoked', revoked_at = clock_timestamp(), version = version + 1
		WHERE id = $1 AND status = 'active'
		RETURNING id::text, principal_id::text, role_name, scope_kind,
		          COALESCE(tenant_id::text, ''), COALESCE(scope_id::text, ''),
		          status, expires_at, version, created_at
	`, command.ID).Scan(
		&assignment.ID, &assignment.PrincipalID, &assignment.RoleName, &assignment.ScopeKind,
		&assignment.TenantID, &assignment.ScopeID, &assignment.Status, &assignment.ExpiresAt, &assignment.Version,
		&assignment.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.RoleAssignment{}, apperrors.New(apperrors.CodeNotFound, "active role assignment was not found")
	}
	if err != nil {
		return app.RoleAssignment{}, mapWriteError(err, "role assignment could not be revoked")
	}
	if err := repository.enqueueRoleEvent(contextValue, transaction, assignment, "user.role.revoked.v1"); err != nil {
		return app.RoleAssignment{}, err
	}
	return assignment, nil
}

func (repository *Postgres) SetPlacementStaffMembership(contextValue context.Context, transaction pgx.Tx, command app.SetPlacementStaffMembership) (app.PlacementStaffMembership, error) {
	if err := repository.requirePlacementDepartment(contextValue, transaction, command.PlacementDepartmentID); err != nil {
		return app.PlacementStaffMembership{}, err
	}
	var membership app.PlacementStaffMembership
	err := transaction.QueryRow(contextValue, `
		INSERT INTO users.placement_department_memberships (
			id, principal_id, placement_department_id, status, expires_at
		) VALUES ($1, $2, $3, 'active', $4)
		ON CONFLICT (principal_id, placement_department_id) DO UPDATE
		SET status = 'active', active_from = clock_timestamp(), expires_at = EXCLUDED.expires_at,
			revoked_at = NULL, version = users.placement_department_memberships.version + 1
		RETURNING id::text, principal_id::text, placement_department_id::text,
		          status, expires_at, version
	`, command.ID, command.PrincipalID, command.PlacementDepartmentID, command.ExpiresAt).Scan(
		&membership.ID, &membership.PrincipalID, &membership.PlacementDepartmentID,
		&membership.Status, &membership.ExpiresAt, &membership.Version,
	)
	if err != nil {
		return app.PlacementStaffMembership{}, mapWriteError(err, "placement staff membership could not be saved")
	}
	payload, err := json.Marshal(struct {
		MembershipID          string `json:"membership_id"`
		PrincipalID           string `json:"principal_id"`
		PlacementDepartmentID string `json:"placement_department_id"`
		Status                string `json:"status"`
	}{
		MembershipID: membership.ID, PrincipalID: membership.PrincipalID,
		PlacementDepartmentID: membership.PlacementDepartmentID, Status: membership.Status,
	})
	if err != nil {
		return app.PlacementStaffMembership{}, fmt.Errorf("encode placement staff event: %w", err)
	}
	if err := repository.enqueue(contextValue, transaction, "placement_staff_membership", membership.ID, "", "user.placement_staff.updated.v1", payload); err != nil {
		return app.PlacementStaffMembership{}, err
	}
	return membership, nil
}

func (repository *Postgres) AssignMentorBatch(contextValue context.Context, transaction pgx.Tx, command app.AssignMentorBatch) (app.MentorBatchAssignment, error) {
	var found bool
	if err := transaction.QueryRow(contextValue, `
		SELECT EXISTS (
			SELECT 1 FROM users.tenant_batch_projections
			WHERE batch_id = $1 AND tenant_id = $2 AND status = 'active'
		)
	`, command.BatchID, command.TenantID).Scan(&found); err != nil {
		return app.MentorBatchAssignment{}, fmt.Errorf("validate batch projection: %w", err)
	}
	if !found {
		return app.MentorBatchAssignment{}, apperrors.New(apperrors.CodeInvalidArgument, "batch projection is missing or does not belong to the tenant")
	}
	var assignment app.MentorBatchAssignment
	err := transaction.QueryRow(contextValue, `
		INSERT INTO users.mentor_batch_assignments (
			id, mentor_principal_id, tenant_id, batch_id, status, assigned_by_principal_id
		) VALUES ($1, $2, $3, $4, 'active', $5)
		ON CONFLICT (mentor_principal_id, batch_id) DO UPDATE
		SET status = 'active', active_from = clock_timestamp(), ended_at = NULL,
			assigned_by_principal_id = EXCLUDED.assigned_by_principal_id,
			version = users.mentor_batch_assignments.version + 1
		RETURNING id::text, mentor_principal_id::text, tenant_id::text, batch_id::text,
		          status, version, created_at
	`, command.ID, command.MentorPrincipalID, command.TenantID, command.BatchID, command.AssignedByPrincipalID).Scan(
		&assignment.ID, &assignment.MentorPrincipalID, &assignment.TenantID, &assignment.BatchID,
		&assignment.Status, &assignment.Version, &assignment.CreatedAt,
	)
	if err != nil {
		return app.MentorBatchAssignment{}, mapWriteError(err, "mentor batch assignment could not be saved")
	}
	payload, err := json.Marshal(struct {
		AssignmentID      string `json:"assignment_id"`
		MentorPrincipalID string `json:"mentor_principal_id"`
		TenantID          string `json:"tenant_id"`
		BatchID           string `json:"batch_id"`
	}{
		AssignmentID: assignment.ID, MentorPrincipalID: assignment.MentorPrincipalID,
		TenantID: assignment.TenantID, BatchID: assignment.BatchID,
	})
	if err != nil {
		return app.MentorBatchAssignment{}, fmt.Errorf("encode mentor batch event: %w", err)
	}
	if err := repository.enqueue(contextValue, transaction, "mentor_batch_assignment", assignment.ID, assignment.TenantID, "user.mentor_batch.assigned.v1", payload); err != nil {
		return app.MentorBatchAssignment{}, err
	}
	return assignment, nil
}

func (repository *Postgres) GetStudentBatchAffiliation(contextValue context.Context, transaction pgx.Tx, command app.GetStudentBatchAffiliation) (app.StudentBatchAffiliation, error) {
	var affiliation app.StudentBatchAffiliation
	err := transaction.QueryRow(contextValue, `
		SELECT student_id::text, tenant_id::text, batch_id::text,
		       lifecycle_state, version, updated_at
		FROM users.get_student_batch_affiliation($1, $2)
	`, command.TenantID, command.StudentID).Scan(
		&affiliation.StudentID, &affiliation.TenantID, &affiliation.BatchID,
		&affiliation.LifecycleState, &affiliation.Version, &affiliation.UpdatedAt,
	)
	if err != nil {
		return app.StudentBatchAffiliation{}, mapWriteError(err, "student batch affiliation was not found")
	}
	return affiliation, nil
}

func (repository *Postgres) SetStudentBatchAffiliation(contextValue context.Context, transaction pgx.Tx, command app.SetStudentBatchAffiliation) (app.StudentBatchAffiliation, error) {
	if replay, replayed, err := repository.claimStudentBatchAffiliationCommand(contextValue, transaction, "set", command.TenantID, command.StudentID, command.ActorID, command.IdempotencyKey, command.RequestChecksum); err != nil {
		return app.StudentBatchAffiliation{}, err
	} else if replayed {
		return replay, nil
	}

	var affiliation app.StudentBatchAffiliation
	var stateChanged bool
	err := transaction.QueryRow(contextValue, `
		SELECT student_id::text, tenant_id::text, batch_id::text,
		       lifecycle_state, version, updated_at, state_changed
		FROM users.set_student_batch_affiliation($1, $2, $3, $4, $5)
	`, command.MembershipID, command.TenantID, command.StudentID, command.BatchID, command.ExpectedVersion).Scan(
		&affiliation.StudentID, &affiliation.TenantID, &affiliation.BatchID,
		&affiliation.LifecycleState, &affiliation.Version, &affiliation.UpdatedAt, &stateChanged,
	)
	if err != nil {
		return app.StudentBatchAffiliation{}, mapWriteError(err, "student batch affiliation could not be saved")
	}
	if stateChanged {
		if err := repository.enqueueStudentBatchAffiliationSnapshot(contextValue, transaction, affiliation); err != nil {
			return app.StudentBatchAffiliation{}, err
		}
	}
	if err := repository.completeStudentBatchAffiliationCommand(contextValue, transaction, "set", command.TenantID, command.StudentID, command.ActorID, command.IdempotencyKey, command.RequestChecksum, affiliation); err != nil {
		return app.StudentBatchAffiliation{}, err
	}
	return affiliation, nil
}

func (repository *Postgres) EndStudentBatchAffiliation(contextValue context.Context, transaction pgx.Tx, command app.EndStudentBatchAffiliation) (app.StudentBatchAffiliation, error) {
	if replay, replayed, err := repository.claimStudentBatchAffiliationCommand(contextValue, transaction, "revoke", command.TenantID, command.StudentID, command.ActorID, command.IdempotencyKey, command.RequestChecksum); err != nil {
		return app.StudentBatchAffiliation{}, err
	} else if replayed {
		return replay, nil
	}

	var affiliation app.StudentBatchAffiliation
	var stateChanged bool
	err := transaction.QueryRow(contextValue, `
		SELECT student_id::text, tenant_id::text, batch_id::text,
		       lifecycle_state, version, updated_at, state_changed
		FROM users.end_student_batch_affiliation($1, $2, $3)
	`, command.TenantID, command.StudentID, command.ExpectedVersion).Scan(
		&affiliation.StudentID, &affiliation.TenantID, &affiliation.BatchID,
		&affiliation.LifecycleState, &affiliation.Version, &affiliation.UpdatedAt, &stateChanged,
	)
	if err != nil {
		return app.StudentBatchAffiliation{}, mapWriteError(err, "student batch affiliation could not be revoked")
	}
	if !stateChanged {
		return app.StudentBatchAffiliation{}, fmt.Errorf("student batch affiliation revoke returned without a state change")
	}
	if err := repository.enqueueStudentBatchAffiliationSnapshot(contextValue, transaction, affiliation); err != nil {
		return app.StudentBatchAffiliation{}, err
	}
	if err := repository.completeStudentBatchAffiliationCommand(contextValue, transaction, "revoke", command.TenantID, command.StudentID, command.ActorID, command.IdempotencyKey, command.RequestChecksum, affiliation); err != nil {
		return app.StudentBatchAffiliation{}, err
	}
	return affiliation, nil
}

// GetStudent retrieves active (non-deleted) student by ID.
// Soft-deleted records are filtered out via WHERE clause per ADR-0013.
func (repository *Postgres) GetStudent(contextValue context.Context, transaction pgx.Tx, studentID string) (app.Student, error) {
	var student app.Student
	err := transaction.QueryRow(contextValue, `
		SELECT student.id::text, student.principal_id::text, student.tenant_id::text,
		       student.enrollment_number, student.status,
		       COALESCE(college.department_id::text, ''),
		       COALESCE(placement.department_id::text, ''),
		       student.version, student.created_at
		FROM users.students AS student
		LEFT JOIN users.current_student_affiliations AS affiliation
		  ON affiliation.student_id = student.id
		LEFT JOIN users.student_department_memberships AS college
		  ON college.id = affiliation.college_membership_id
		LEFT JOIN users.student_department_memberships AS placement
		  ON placement.id = affiliation.placement_membership_id
		WHERE student.id = $1
		  AND student.deleted_at IS NULL
	`, studentID).Scan(
		&student.ID, &student.PrincipalID, &student.TenantID, &student.EnrollmentNumber,
		&student.Status, &student.CollegeDepartmentID, &student.PlacementDepartmentID,
		&student.Version, &student.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Student{}, apperrors.New(apperrors.CodeNotFound, "student was not found")
	}
	if err != nil {
		return app.Student{}, fmt.Errorf("read student: %w", err)
	}
	return student, nil
}

// GetStudentIncludeDeleted retrieves student including soft-deleted.
// Requires authorization check before calling (SuperAdmin or role with archive access).
func (repository *Postgres) GetStudentIncludeDeleted(contextValue context.Context, transaction pgx.Tx, studentID string) (app.Student, error) {
	var student app.Student
	err := transaction.QueryRow(contextValue, `
		SELECT student.id::text, student.principal_id::text, student.tenant_id::text,
		       student.enrollment_number, student.status,
		       COALESCE(college.department_id::text, ''),
		       COALESCE(placement.department_id::text, ''),
		       student.version, student.created_at
		FROM users.students AS student
		LEFT JOIN users.current_student_affiliations AS affiliation
		  ON affiliation.student_id = student.id
		LEFT JOIN users.student_department_memberships AS college
		  ON college.id = affiliation.college_membership_id
		LEFT JOIN users.student_department_memberships AS placement
		  ON placement.id = affiliation.placement_membership_id
		WHERE student.id = $1
	`, studentID).Scan(
		&student.ID, &student.PrincipalID, &student.TenantID, &student.EnrollmentNumber,
		&student.Status, &student.CollegeDepartmentID, &student.PlacementDepartmentID,
		&student.Version, &student.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Student{}, apperrors.New(apperrors.CodeNotFound, "student was not found")
	}
	if err != nil {
		return app.Student{}, fmt.Errorf("read student: %w", err)
	}
	return student, nil
}

// SoftDeleteStudent marks student as deleted with audit trail.
// Uses UPDATE with deleted_at, deleted_by, deletion_reason per ADR-0013.
func (repository *Postgres) SoftDeleteStudent(contextValue context.Context, transaction pgx.Tx, command app.DeleteStudent) error {
	result, err := transaction.Exec(contextValue, `
		UPDATE users.students
		SET deleted_at = clock_timestamp(),
		    deleted_by = $2,
		    deletion_reason = $3,
		    updated_at = clock_timestamp(),
		    version = version + 1
		WHERE id = $1
		  AND deleted_at IS NULL
	`, command.ID, command.ActorID, command.Reason)
	if err != nil {
		return mapWriteError(err, "soft delete failed")
	}
	if result.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "student not found or already deleted")
	}

	payload, err := json.Marshal(struct {
		StudentID string `json:"student_id"`
		ActorID   string `json:"actor_id"`
		Reason    string `json:"reason"`
	}{
		StudentID: command.ID,
		ActorID:   command.ActorID,
		Reason:    command.Reason,
	})
	if err != nil {
		return fmt.Errorf("encode student soft delete event: %w", err)
	}
	return repository.enqueue(contextValue, transaction, "student", command.ID, "", "user.student.soft_deleted.v1", payload)
}

// HardDeleteStudent permanently removes student via security-definer function.
// Only SuperAdmin can execute this (enforced via RLS and function).
func (repository *Postgres) HardDeleteStudent(contextValue context.Context, transaction pgx.Tx, command app.DeleteStudent) error {
	var success bool
	err := transaction.QueryRow(contextValue, `
		SELECT app.hard_delete('users.students', $1::uuid, $2::uuid, $3)
	`, command.ID, command.ActorID, command.Reason).Scan(&success)
	if err != nil {
		return mapWriteError(err, "hard delete failed")
	}
	if !success {
		return apperrors.New(apperrors.CodeForbidden, "hard delete denied: insufficient permissions or record not found")
	}

	payload, err := json.Marshal(struct {
		StudentID string `json:"student_id"`
		ActorID   string `json:"actor_id"`
		Reason    string `json:"reason"`
	}{
		StudentID: command.ID,
		ActorID:   command.ActorID,
		Reason:    command.Reason,
	})
	if err != nil {
		return fmt.Errorf("encode student hard delete event: %w", err)
	}
	return repository.enqueue(contextValue, transaction, "student", command.ID, "", "user.student.hard_deleted.v1", payload)
}

func (repository *Postgres) enqueueRoleEvent(contextValue context.Context, transaction pgx.Tx, assignment app.RoleAssignment, eventType string) error {
	payload, err := json.Marshal(struct {
		RoleAssignmentID string `json:"role_assignment_id"`
		PrincipalID      string `json:"principal_id"`
		RoleName         string `json:"role_name"`
		ScopeKind        string `json:"scope_kind"`
		TenantID         string `json:"tenant_id,omitempty"`
		ScopeID          string `json:"scope_id,omitempty"`
		Status           string `json:"status"`
	}{
		RoleAssignmentID: assignment.ID, PrincipalID: assignment.PrincipalID,
		RoleName: assignment.RoleName, ScopeKind: assignment.ScopeKind,
		TenantID: assignment.TenantID, ScopeID: assignment.ScopeID, Status: assignment.Status,
	})
	if err != nil {
		return fmt.Errorf("encode role assignment event: %w", err)
	}
	return repository.enqueue(contextValue, transaction, "role_assignment", assignment.ID, assignment.TenantID, eventType, payload)
}

// claimStudentBatchAffiliationCommand uses User's existing command ledger in
// the same RLS-bound transaction as the state procedure and outbox write.
// A durable completed response is returned without re-running the procedure.
func (repository *Postgres) claimStudentBatchAffiliationCommand(
	contextValue context.Context,
	transaction pgx.Tx,
	operation, tenantID, studentID, actorID, idempotencyKey string,
	requestChecksum []byte,
) (app.StudentBatchAffiliation, bool, error) {
	scope, err := studentBatchAffiliationCommandScope(operation, tenantID, studentID, actorID)
	if err != nil {
		return app.StudentBatchAffiliation{}, false, err
	}
	if len(requestChecksum) != 32 {
		return app.StudentBatchAffiliation{}, false, apperrors.New(apperrors.CodeInvalidArgument, "idempotency request checksum is invalid")
	}
	if _, err := transaction.Exec(contextValue, `
		DELETE FROM app.command_idempotency
		WHERE command_scope = $1
		  AND idempotency_key = $2
		  AND expires_at <= clock_timestamp()
	`, scope, idempotencyKey); err != nil {
		return app.StudentBatchAffiliation{}, false, fmt.Errorf("purge expired student batch affiliation idempotency record: %w", err)
	}

	var acquired bool
	err = transaction.QueryRow(contextValue, `
		INSERT INTO app.command_idempotency (
			command_scope, idempotency_key, request_sha256, expires_at
		) VALUES (
			$1, $2, $3, clock_timestamp() + interval '24 hours'
		)
		ON CONFLICT (command_scope, idempotency_key) DO NOTHING
		RETURNING true
	`, scope, idempotencyKey, requestChecksum).Scan(&acquired)
	if err == nil && acquired {
		return app.StudentBatchAffiliation{}, false, nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return app.StudentBatchAffiliation{}, false, fmt.Errorf("claim student batch affiliation idempotency record: %w", err)
	}

	var storedChecksum []byte
	var responseCode int
	var responseBody json.RawMessage
	var completedAt *time.Time
	err = transaction.QueryRow(contextValue, `
		SELECT request_sha256, COALESCE(response_code, 0),
		       COALESCE(response_body, 'null'::jsonb), completed_at
		FROM app.command_idempotency
		WHERE command_scope = $1 AND idempotency_key = $2
		FOR UPDATE
	`, scope, idempotencyKey).Scan(&storedChecksum, &responseCode, &responseBody, &completedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.StudentBatchAffiliation{}, false, fmt.Errorf("student batch affiliation idempotency record disappeared")
	}
	if err != nil {
		return app.StudentBatchAffiliation{}, false, fmt.Errorf("read student batch affiliation idempotency record: %w", err)
	}
	if !bytes.Equal(storedChecksum, requestChecksum) {
		return app.StudentBatchAffiliation{}, false, apperrors.New(apperrors.CodeConflict, "Idempotency-Key was already used for a different request")
	}
	if completedAt == nil || responseCode != 200 {
		return app.StudentBatchAffiliation{}, false, apperrors.New(apperrors.CodeConflict, "Idempotency-Key is still in progress; retry shortly")
	}
	var affiliation app.StudentBatchAffiliation
	if err := json.Unmarshal(responseBody, &affiliation); err != nil {
		return app.StudentBatchAffiliation{}, false, fmt.Errorf("decode stored student batch affiliation response: %w", err)
	}
	return affiliation, true, nil
}

func (repository *Postgres) completeStudentBatchAffiliationCommand(
	contextValue context.Context,
	transaction pgx.Tx,
	operation, tenantID, studentID, actorID, idempotencyKey string,
	requestChecksum []byte,
	affiliation app.StudentBatchAffiliation,
) error {
	scope, err := studentBatchAffiliationCommandScope(operation, tenantID, studentID, actorID)
	if err != nil {
		return err
	}
	responseBody, err := json.Marshal(affiliation)
	if err != nil {
		return fmt.Errorf("encode student batch affiliation idempotency response: %w", err)
	}
	commandTag, err := transaction.Exec(contextValue, `
		UPDATE app.command_idempotency
		SET response_code = 200,
		    response_body = $4::jsonb,
		    completed_at = clock_timestamp()
		WHERE command_scope = $1
		  AND idempotency_key = $2
		  AND request_sha256 = $3
		  AND completed_at IS NULL
	`, scope, idempotencyKey, requestChecksum, string(responseBody))
	if err != nil {
		return fmt.Errorf("complete student batch affiliation idempotency record: %w", err)
	}
	if commandTag.RowsAffected() != 1 {
		return apperrors.New(apperrors.CodeConflict, "Idempotency-Key is not available for completion")
	}
	return nil
}

func studentBatchAffiliationCommandScope(operation, tenantID, studentID, actorID string) (string, error) {
	if operation != "set" && operation != "revoke" {
		return "", apperrors.New(apperrors.CodeInvalidArgument, "student batch affiliation idempotency scope is invalid")
	}
	scope := "sba." + operation + "." + tenantID + "." + studentID + "." + actorID
	if len(scope) > 127 {
		return "", apperrors.New(apperrors.CodeInvalidArgument, "student batch affiliation idempotency scope is invalid")
	}
	return scope, nil
}

func (repository *Postgres) enqueueStudentBatchAffiliationSnapshot(contextValue context.Context, transaction pgx.Tx, affiliation app.StudentBatchAffiliation) error {
	payload, err := studentBatchAffiliationSnapshotPayload(affiliation)
	if err != nil {
		return err
	}
	return repository.enqueue(
		contextValue, transaction, "student", affiliation.StudentID, affiliation.TenantID,
		"user.student_batch_affiliation.snapshot.v1", payload,
	)
}

func studentBatchAffiliationSnapshotPayload(affiliation app.StudentBatchAffiliation) (json.RawMessage, error) {
	payload, err := json.Marshal(struct {
		TenantID       string  `json:"tenant_id"`
		StudentID      string  `json:"student_id"`
		BatchID        *string `json:"batch_id"`
		LifecycleState string  `json:"lifecycle_state"`
		Version        int     `json:"version"`
	}{
		TenantID: affiliation.TenantID, StudentID: affiliation.StudentID,
		BatchID: affiliation.BatchID, LifecycleState: affiliation.LifecycleState,
		Version: affiliation.Version,
	})
	if err != nil {
		return nil, fmt.Errorf("encode student batch affiliation snapshot: %w", err)
	}
	return payload, nil
}

func (repository *Postgres) validateRoleScope(contextValue context.Context, transaction pgx.Tx, command app.AssignRole) error {
	switch command.ScopeKind {
	case "department":
		var found bool
		if err := transaction.QueryRow(contextValue, `
			SELECT EXISTS (
				SELECT 1 FROM users.tenant_department_projections
				WHERE department_id = $1 AND tenant_id = $2
				  AND department_type = 'college' AND status = 'active'
			)
		`, command.ScopeID, command.TenantID).Scan(&found); err != nil {
			return fmt.Errorf("validate department projection: %w", err)
		}
		if !found {
			return apperrors.New(apperrors.CodeInvalidArgument, "department projection is missing or does not belong to the tenant")
		}
	case "batch":
		var found bool
		if err := transaction.QueryRow(contextValue, `
			SELECT EXISTS (
				SELECT 1 FROM users.tenant_batch_projections
				WHERE batch_id = $1 AND tenant_id = $2 AND status = 'active'
			)
		`, command.ScopeID, command.TenantID).Scan(&found); err != nil {
			return fmt.Errorf("validate batch projection: %w", err)
		}
		if !found {
			return apperrors.New(apperrors.CodeInvalidArgument, "batch projection is missing or does not belong to the tenant")
		}
	case "placement_department":
		return repository.requirePlacementDepartment(contextValue, transaction, command.ScopeID)
	}
	return nil
}

func (repository *Postgres) requirePlacementDepartment(contextValue context.Context, transaction pgx.Tx, departmentID string) error {
	var found bool
	if err := transaction.QueryRow(contextValue, `
		SELECT EXISTS (
			SELECT 1 FROM users.tenant_department_projections
			WHERE department_id = $1 AND department_type = 'placement' AND status = 'active'
		)
	`, departmentID).Scan(&found); err != nil {
		return fmt.Errorf("validate placement department projection: %w", err)
	}
	if !found {
		return apperrors.New(apperrors.CodeInvalidArgument, "placement department projection is missing or inactive")
	}
	return nil
}

func (repository *Postgres) enqueue(contextValue context.Context, transaction pgx.Tx, aggregateType, aggregateID, tenantID, eventType string, payload json.RawMessage) error {
	eventID, err := database.NewUUIDv7()
	if err != nil {
		return err
	}
	outbox, err := messaging.NewOutboxStore(repository.pool, "app.outbox_events")
	if err != nil {
		return fmt.Errorf("initialize User outbox store: %w", err)
	}
	if err := outbox.Enqueue(contextValue, transaction, database.OutboxEvent{
		EventID: eventID, AggregateType: aggregateType, AggregateID: aggregateID,
		TenantID: tenantID, EventType: eventType, SchemaVersion: 1,
		Payload: payload, OccurredAt: time.Now().UTC(),
	}); err != nil {
		return fmt.Errorf("enqueue User domain event: %w", err)
	}
	return nil
}

func mapWriteError(err error, message string) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		switch postgresError.Code {
		case "23505", "40001":
			return apperrors.New(apperrors.CodeConflict, message)
		case "23503", "23514", "22P02":
			return apperrors.New(apperrors.CodeInvalidArgument, message)
		case "P0002":
			return apperrors.New(apperrors.CodeNotFound, message)
		case "42501":
			return apperrors.New(apperrors.CodeForbidden, "authorization denied")
		}
	}
	return fmt.Errorf("write User record: %w", err)
}

// ListStudents returns up to command.Limit students within a tenant,
// sorted by (created_at DESC, id DESC) for stable keyset pagination.
// Batch filter uses current_student_batch_affiliations.batch_id;
// department filter uses student_department_memberships.department_id.
func (repository *Postgres) ListStudents(contextValue context.Context, transaction pgx.Tx, command app.ListStudents) ([]app.Student, error) {
	rows, err := transaction.Query(contextValue, `
		SELECT student.id::text, student.principal_id::text, student.tenant_id::text,
		       student.enrollment_number, student.status,
		       student.version, student.created_at
		FROM users.students AS student
		WHERE student.tenant_id = $1
		  AND student.deleted_at IS NULL
		  AND ($2::text IS NULL OR student.status = $2)
		  AND ($3::text IS NULL OR student.enrollment_number LIKE $3 || '%')
		  AND (
		        $4::uuid IS NULL
		        OR EXISTS (
		            SELECT 1 FROM users.current_student_batch_affiliations AS affil
		            WHERE affil.student_id = student.id
		              AND affil.batch_id = $4
		              AND affil.lifecycle_state = 'active'
		        )
		      )
		  AND (
		        $5::uuid IS NULL
		        OR EXISTS (
		            SELECT 1 FROM users.student_department_memberships AS membership
		            WHERE membership.student_id = student.id
		              AND membership.department_id = $5
		              AND membership.deleted_at IS NULL
		        )
		      )
		  AND ($6::timestamptz IS NULL OR (student.created_at, student.id) < ($6, $7::uuid))
		ORDER BY student.created_at DESC, student.id DESC
		LIMIT $8
	`,
		command.TenantID, nullableText(command.Status),
		nullableText(command.EnrollmentNumberPrefix),
		nullableText(command.BatchID), nullableText(command.DepartmentID),
		nullableTimestamp(command.CursorSort), nullableText(command.CursorID),
		command.Limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list students: %w", err)
	}
	defer rows.Close()

	students := make([]app.Student, 0, command.Limit)
	for rows.Next() {
		var student app.Student
		if err := rows.Scan(
			&student.ID, &student.PrincipalID, &student.TenantID,
			&student.EnrollmentNumber, &student.Status,
			&student.Version, &student.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan student row: %w", err)
		}
		students = append(students, student)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read student rows: %w", err)
	}
	return students, nil
}

// ListMentorBatchAssignments returns up to command.Limit active mentor
// assignments for one batch, sorted by (created_at DESC, id DESC).
func (repository *Postgres) ListMentorBatchAssignments(contextValue context.Context, transaction pgx.Tx, command app.ListMentorBatchAssignments) ([]app.MentorBatchAssignment, error) {
	rows, err := transaction.Query(contextValue, `
		SELECT id::text, mentor_principal_id::text, tenant_id::text, batch_id::text,
		       status, version, created_at
		FROM users.mentor_batch_assignments
		WHERE tenant_id = $1
		  AND batch_id = $2
		  AND deleted_at IS NULL
		  AND ($3::timestamptz IS NULL OR (created_at, id) < ($3, $4::uuid))
		ORDER BY created_at DESC, id DESC
		LIMIT $5
	`,
		command.TenantID, command.BatchID,
		nullableTimestamp(command.CursorSort), nullableText(command.CursorID),
		command.Limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list mentor batch assignments: %w", err)
	}
	defer rows.Close()

	assignments := make([]app.MentorBatchAssignment, 0, command.Limit)
	for rows.Next() {
		var assignment app.MentorBatchAssignment
		if err := rows.Scan(
			&assignment.ID, &assignment.MentorPrincipalID, &assignment.TenantID, &assignment.BatchID,
			&assignment.Status, &assignment.Version, &assignment.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan mentor batch assignment row: %w", err)
		}
		assignments = append(assignments, assignment)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read mentor batch assignment rows: %w", err)
	}
	return assignments, nil
}

// ListRoleAssignments returns up to command.Limit role assignments,
// sorted by (created_at DESC, id DESC). TenantID, PrincipalID, RoleName,
// and ScopeKind are optional filters.
func (repository *Postgres) ListRoleAssignments(contextValue context.Context, transaction pgx.Tx, command app.ListRoleAssignments) ([]app.RoleAssignment, error) {
	rows, err := transaction.Query(contextValue, `
		SELECT id::text, principal_id::text, role_name, scope_kind,
		       COALESCE(tenant_id::text, ''), COALESCE(scope_id::text, ''),
		       status, expires_at, version, created_at
		FROM users.role_assignments
		WHERE deleted_at IS NULL
		  AND ($1::uuid IS NULL OR tenant_id = $1::uuid)
		  AND ($2::uuid IS NULL OR principal_id = $2::uuid)
		  AND ($3::text IS NULL OR role_name = $3)
		  AND ($4::text IS NULL OR scope_kind = $4)
		  AND ($5::timestamptz IS NULL OR (created_at, id) < ($5, $6::uuid))
		ORDER BY created_at DESC, id DESC
		LIMIT $7
	`,
		nullableText(command.TenantID), nullableText(command.PrincipalID),
		nullableText(command.RoleName), nullableText(command.ScopeKind),
		nullableTimestamp(command.CursorSort), nullableText(command.CursorID),
		command.Limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list role assignments: %w", err)
	}
	defer rows.Close()

	assignments := make([]app.RoleAssignment, 0, command.Limit)
	for rows.Next() {
		var assignment app.RoleAssignment
		if err := rows.Scan(
			&assignment.ID, &assignment.PrincipalID, &assignment.RoleName, &assignment.ScopeKind,
			&assignment.TenantID, &assignment.ScopeID, &assignment.Status, &assignment.ExpiresAt,
			&assignment.Version, &assignment.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan role assignment row: %w", err)
		}
		assignments = append(assignments, assignment)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read role assignment rows: %w", err)
	}
	return assignments, nil
}

// nullableText returns nil when the value is blank, otherwise the trimmed
// value. Used for both text and UUID SQL parameters so only one helper is
// needed; the type cast (e.g. $1::uuid) is done in SQL.
func nullableText(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

// nullableTimestamp parses an RFC3339Nano string and returns nil when it is
// blank or unparseable. The app layer validates the format, so a parse failure
// here means an empty cursor rather than an error.
func nullableTimestamp(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return nil
	}
	return parsed.UTC()
}
