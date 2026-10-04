package repo

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aethercode/aethercode/services/user/internal/app"
	"github.com/jackc/pgx/v5"
)

// ExistingEnrollmentNumbers validates an import's departments and batch and
// returns the roll numbers the college already has.
func (repository *Postgres) ExistingEnrollmentNumbers(contextValue context.Context, transaction pgx.Tx, command app.StudentImport, numbers []string) ([]string, error) {
	rows, err := transaction.Query(contextValue, `
		SELECT users.existing_enrollment_numbers($1, $2, $3, $4, $5::text[])
	`, command.TenantID, command.BatchID, command.CollegeDepartmentID, command.PlacementDepartmentID, numbers)
	if err != nil {
		return nil, mapWriteError(err, "student import targets are invalid")
	}
	existing, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, mapWriteError(err, "student import targets are invalid")
	}
	return existing, nil
}

// ImportStudents enrolls the provisioned principals and publishes the same
// enrollment and batch-affiliation events the single-student commands do.
func (repository *Postgres) ImportStudents(contextValue context.Context, transaction pgx.Tx, command app.StudentImport, actorID string, credentials []app.IssuedCredential, numbers []string) ([]app.Student, error) {
	principalIDs := make([]string, len(credentials))
	for index, credential := range credentials {
		principalIDs[index] = credential.PrincipalID
	}
	rows, err := transaction.Query(contextValue, `
		SELECT out_student_id::text, out_principal_id::text, out_enrollment_number,
		       out_student_version, out_affiliation_version, out_created_at
		FROM users.import_students($1, $2, $3, $4, $5, $6::uuid[], $7::text[])
	`, command.TenantID, command.BatchID, command.CollegeDepartmentID, command.PlacementDepartmentID,
		actorID, principalIDs, numbers)
	if err != nil {
		return nil, mapWriteError(err, "students could not be imported")
	}
	var affiliationVersions []int
	students, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (app.Student, error) {
		student := app.Student{TenantID: command.TenantID, Status: "active",
			CollegeDepartmentID: command.CollegeDepartmentID, PlacementDepartmentID: command.PlacementDepartmentID}
		var affiliationVersion int
		err := row.Scan(&student.ID, &student.PrincipalID, &student.EnrollmentNumber,
			&student.Version, &affiliationVersion, &student.CreatedAt)
		affiliationVersions = append(affiliationVersions, affiliationVersion)
		return student, err
	})
	if err != nil {
		return nil, mapWriteError(err, "students could not be imported")
	}
	if len(students) != len(credentials) {
		return nil, fmt.Errorf("import enrolled %d of %d students", len(students), len(credentials))
	}
	batchID := command.BatchID
	for index, student := range students {
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
			return nil, fmt.Errorf("encode student enrollment event: %w", err)
		}
		if err := repository.enqueue(contextValue, transaction, "student", student.ID, student.TenantID, "user.student.enrolled.v1", payload); err != nil {
			return nil, err
		}
		if err := repository.enqueueStudentBatchAffiliationSnapshot(contextValue, transaction, app.StudentBatchAffiliation{
			StudentID: student.ID, TenantID: student.TenantID, BatchID: &batchID,
			LifecycleState: "active", Version: affiliationVersions[index],
		}); err != nil {
			return nil, err
		}
	}
	return students, nil
}

// TenantAccountPrincipals returns the subset of principals the college may
// manage: its own students and staff that hold nothing elsewhere.
func (repository *Postgres) TenantAccountPrincipals(contextValue context.Context, transaction pgx.Tx, tenantID string, principalIDs []string) ([]string, error) {
	rows, err := transaction.Query(contextValue, `
		SELECT principal_id::text FROM users.tenant_account_principals($1, $2::uuid[]) AS principal_id
	`, tenantID, principalIDs)
	if err != nil {
		return nil, mapWriteError(err, "accounts could not be checked")
	}
	manageable, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, mapWriteError(err, "accounts could not be checked")
	}
	return manageable, nil
}

// BatchAccountPrincipals lists the manageable students currently in a batch,
// ordered by roll number.
func (repository *Postgres) BatchAccountPrincipals(contextValue context.Context, transaction pgx.Tx, tenantID, batchID string) ([]string, error) {
	rows, err := transaction.Query(contextValue, `
		SELECT out_principal_id::text FROM users.batch_account_principals($1, $2)
	`, tenantID, batchID)
	if err != nil {
		return nil, mapWriteError(err, "batch accounts could not be listed")
	}
	principalIDs, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, mapWriteError(err, "batch accounts could not be listed")
	}
	return principalIDs, nil
}

// GrantStaffRole makes a provisioned principal a college administrator or a
// department's faculty member.
func (repository *Postgres) GrantStaffRole(contextValue context.Context, transaction pgx.Tx, command app.StaffAccount, principalID, actorID string) (app.RoleAssignment, error) {
	assignment := app.RoleAssignment{PrincipalID: principalID, RoleName: command.Role, TenantID: command.TenantID}
	err := transaction.QueryRow(contextValue, `
		SELECT out_id::text, out_scope_kind, out_scope_id::text, out_status, out_version, out_created_at
		FROM users.grant_staff_role($1, $2, $3, NULLIF($4, '')::uuid, $5)
	`, command.TenantID, principalID, command.Role, command.DepartmentID, actorID).Scan(
		&assignment.ID, &assignment.ScopeKind, &assignment.ScopeID, &assignment.Status,
		&assignment.Version, &assignment.CreatedAt,
	)
	if err != nil {
		return app.RoleAssignment{}, mapWriteError(err, "staff role could not be granted")
	}
	if err := repository.enqueueRoleEvent(contextValue, transaction, assignment, "user.role.assigned.v1"); err != nil {
		return app.RoleAssignment{}, err
	}
	return assignment, nil
}
