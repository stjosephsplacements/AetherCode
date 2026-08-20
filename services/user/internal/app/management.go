package app

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var enrollmentPattern = regexp.MustCompile(`^\S(?:.*\S)?$`)

// ManagementStore owns user-domain persistence. Its methods always run inside
// a transaction already bound to one fresh central authorization capability.
type ManagementStore interface {
	UpsertProfile(context.Context, pgx.Tx, UpsertProfile) (Profile, error)
	EnrollStudent(context.Context, pgx.Tx, EnrollStudent) (Student, error)
	AssignRole(context.Context, pgx.Tx, AssignRole) (RoleAssignment, error)
	RevokeRole(context.Context, pgx.Tx, RevokeRole) (RoleAssignment, error)
	SetPlacementStaffMembership(context.Context, pgx.Tx, SetPlacementStaffMembership) (PlacementStaffMembership, error)
	AssignMentorBatch(context.Context, pgx.Tx, AssignMentorBatch) (MentorBatchAssignment, error)
	GetStudentBatchAffiliation(context.Context, pgx.Tx, GetStudentBatchAffiliation) (StudentBatchAffiliation, error)
	SetStudentBatchAffiliation(context.Context, pgx.Tx, SetStudentBatchAffiliation) (StudentBatchAffiliation, error)
	EndStudentBatchAffiliation(context.Context, pgx.Tx, EndStudentBatchAffiliation) (StudentBatchAffiliation, error)
	GetStudent(context.Context, pgx.Tx, string) (Student, error)
	GetStudentIncludeDeleted(context.Context, pgx.Tx, string) (Student, error)
	SoftDeleteStudent(context.Context, pgx.Tx, DeleteStudent) error
	HardDeleteStudent(context.Context, pgx.Tx, DeleteStudent) error
	Ping(context.Context) error
}

type Profile struct {
	PrincipalID   string    `json:"principal_id"`
	GivenName     string    `json:"given_name"`
	FamilyName    string    `json:"family_name"`
	PreferredName string    `json:"preferred_name,omitempty"`
	Version       int       `json:"version"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type Student struct {
	ID                    string    `json:"id"`
	PrincipalID           string    `json:"principal_id"`
	TenantID              string    `json:"tenant_id"`
	EnrollmentNumber      string    `json:"enrollment_number"`
	Status                string    `json:"status"`
	CollegeDepartmentID   string    `json:"college_department_id,omitempty"`
	PlacementDepartmentID string    `json:"placement_department_id,omitempty"`
	Version               int       `json:"version"`
	CreatedAt             time.Time `json:"created_at"`
}

type RoleAssignment struct {
	ID          string     `json:"id"`
	PrincipalID string     `json:"principal_id"`
	RoleName    string     `json:"role_name"`
	ScopeKind   string     `json:"scope_kind"`
	TenantID    string     `json:"tenant_id,omitempty"`
	ScopeID     string     `json:"scope_id,omitempty"`
	Status      string     `json:"status"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	Version     int        `json:"version"`
}

type PlacementStaffMembership struct {
	ID                    string     `json:"id"`
	PrincipalID           string     `json:"principal_id"`
	PlacementDepartmentID string     `json:"placement_department_id"`
	Status                string     `json:"status"`
	ExpiresAt             *time.Time `json:"expires_at,omitempty"`
	Version               int        `json:"version"`
}

type MentorBatchAssignment struct {
	ID                string `json:"id"`
	MentorPrincipalID string `json:"mentor_principal_id"`
	TenantID          string `json:"tenant_id"`
	BatchID           string `json:"batch_id"`
	Status            string `json:"status"`
	Version           int    `json:"version"`
}

// StudentBatchAffiliation is the one versioned current batch state for a
// student. BatchID is null only after the affiliation has been revoked.
type StudentBatchAffiliation struct {
	StudentID      string    `json:"student_id"`
	TenantID       string    `json:"tenant_id"`
	BatchID        *string   `json:"batch_id"`
	LifecycleState string    `json:"lifecycle_state"`
	Version        int       `json:"version"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type UpsertProfile struct {
	PrincipalID   string
	GivenName     string
	FamilyName    string
	PreferredName string
}

type EnrollStudent struct {
	ID                    string
	PrincipalID           string
	TenantID              string
	EnrollmentNumber      string
	CollegeDepartmentID   string
	PlacementDepartmentID string
	CollegeMembershipID   string
	PlacementMembershipID string
	GrantedStudentRoleID  string
	CreatedByPrincipalID  string
}

type AssignRole struct {
	ID                   string
	PrincipalID          string
	RoleName             string
	ScopeKind            string
	TenantID             string
	ScopeID              string
	GrantedByPrincipalID string
	ExpiresAt            *time.Time
}

type RevokeRole struct {
	ID string
}

type SetPlacementStaffMembership struct {
	ID                    string
	PrincipalID           string
	PlacementDepartmentID string
	ExpiresAt             *time.Time
}

type AssignMentorBatch struct {
	ID                    string
	MentorPrincipalID     string
	TenantID              string
	BatchID               string
	AssignedByPrincipalID string
}

type SetStudentBatchAffiliation struct {
	MembershipID    string
	TenantID        string
	StudentID       string
	BatchID         string
	ExpectedVersion int
	ActorID         string
	IdempotencyKey  string
	RequestChecksum []byte
}

type GetStudentBatchAffiliation struct {
	TenantID  string
	StudentID string
}

type EndStudentBatchAffiliation struct {
	TenantID        string
	StudentID       string
	ExpectedVersion int
	ActorID         string
	IdempotencyKey  string
	RequestChecksum []byte
}

type DeleteStudent struct {
	ID      string
	ActorID string
	Reason  string
}

// ManagementService coordinates domain commands and the local RLS boundary.
type ManagementService struct {
	pool  *pgxpool.Pool
	store ManagementStore
}

func NewManagementService(pool *pgxpool.Pool, store ManagementStore) (*ManagementService, error) {
	if pool == nil || store == nil {
		return nil, fmt.Errorf("user database pool and management store are required")
	}
	return &ManagementService{pool: pool, store: store}, nil
}

func (service *ManagementService) UpsertProfile(contextValue context.Context, capability centralauthz.Capability, command UpsertProfile) (Profile, error) {
	command.GivenName, command.FamilyName, command.PreferredName = strings.TrimSpace(command.GivenName), strings.TrimSpace(command.FamilyName), strings.TrimSpace(command.PreferredName)
	if !isUUID(command.PrincipalID) || !validName(command.GivenName) || !validName(command.FamilyName) || (command.PreferredName != "" && !validName(command.PreferredName)) {
		return Profile{}, apperrors.New(apperrors.CodeInvalidArgument, "profile fields are invalid")
	}
	var profile Profile
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		profile, err = service.store.UpsertProfile(contextValue, transaction, command)
		return err
	})
	return profile, err
}

func (service *ManagementService) EnrollStudent(contextValue context.Context, capability centralauthz.Capability, command EnrollStudent) (Student, error) {
	command.EnrollmentNumber = strings.TrimSpace(command.EnrollmentNumber)
	if !isUUID(command.ID) || !isUUID(command.PrincipalID) || !isUUID(command.TenantID) ||
		!isUUID(command.CollegeDepartmentID) || !isUUID(command.PlacementDepartmentID) ||
		!isUUID(command.CollegeMembershipID) || !isUUID(command.PlacementMembershipID) ||
		!isUUID(command.GrantedStudentRoleID) || !isUUID(command.CreatedByPrincipalID) ||
		!validEnrollmentNumber(command.EnrollmentNumber) {
		return Student{}, apperrors.New(apperrors.CodeInvalidArgument, "student enrollment fields are invalid")
	}
	var student Student
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		student, err = service.store.EnrollStudent(contextValue, transaction, command)
		return err
	})
	return student, err
}

func (service *ManagementService) AssignRole(contextValue context.Context, capability centralauthz.Capability, command AssignRole) (RoleAssignment, error) {
	if !isUUID(command.ID) || !isUUID(command.PrincipalID) || !isUUID(command.GrantedByPrincipalID) || !validRoleScope(command) || expired(command.ExpiresAt) {
		return RoleAssignment{}, apperrors.New(apperrors.CodeInvalidArgument, "role assignment fields are invalid")
	}
	var assignment RoleAssignment
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		assignment, err = service.store.AssignRole(contextValue, transaction, command)
		return err
	})
	return assignment, err
}

func (service *ManagementService) RevokeRole(contextValue context.Context, capability centralauthz.Capability, command RevokeRole) (RoleAssignment, error) {
	if !isUUID(command.ID) {
		return RoleAssignment{}, apperrors.New(apperrors.CodeInvalidArgument, "role assignment ID must be a UUID")
	}
	var assignment RoleAssignment
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		assignment, err = service.store.RevokeRole(contextValue, transaction, command)
		return err
	})
	return assignment, err
}

func (service *ManagementService) SetPlacementStaffMembership(contextValue context.Context, capability centralauthz.Capability, command SetPlacementStaffMembership) (PlacementStaffMembership, error) {
	if !isUUID(command.ID) || !isUUID(command.PrincipalID) || !isUUID(command.PlacementDepartmentID) || expired(command.ExpiresAt) {
		return PlacementStaffMembership{}, apperrors.New(apperrors.CodeInvalidArgument, "placement staff membership IDs are invalid")
	}
	var membership PlacementStaffMembership
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		membership, err = service.store.SetPlacementStaffMembership(contextValue, transaction, command)
		return err
	})
	return membership, err
}

func (service *ManagementService) AssignMentorBatch(contextValue context.Context, capability centralauthz.Capability, command AssignMentorBatch) (MentorBatchAssignment, error) {
	if !isUUID(command.ID) || !isUUID(command.MentorPrincipalID) || !isUUID(command.TenantID) || !isUUID(command.BatchID) || !isUUID(command.AssignedByPrincipalID) {
		return MentorBatchAssignment{}, apperrors.New(apperrors.CodeInvalidArgument, "mentor batch assignment IDs are invalid")
	}
	var assignment MentorBatchAssignment
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		assignment, err = service.store.AssignMentorBatch(contextValue, transaction, command)
		return err
	})
	return assignment, err
}

// SetStudentBatchAffiliation atomically ends any prior membership, creates
// the new immutable history interval, and advances the current-row version.
func (service *ManagementService) SetStudentBatchAffiliation(contextValue context.Context, capability centralauthz.Capability, command SetStudentBatchAffiliation) (StudentBatchAffiliation, error) {
	command.MembershipID = strings.ToLower(strings.TrimSpace(command.MembershipID))
	command.TenantID = strings.ToLower(strings.TrimSpace(command.TenantID))
	command.StudentID = strings.ToLower(strings.TrimSpace(command.StudentID))
	command.BatchID = strings.ToLower(strings.TrimSpace(command.BatchID))
	command.ActorID = strings.ToLower(strings.TrimSpace(command.ActorID))
	command.IdempotencyKey = strings.ToLower(strings.TrimSpace(command.IdempotencyKey))
	if !isUUID(command.MembershipID) || !isUUID(command.TenantID) || !isUUID(command.StudentID) || !isUUID(command.BatchID) ||
		command.ExpectedVersion <= 0 || !isUUID(command.ActorID) || !isUUID(command.IdempotencyKey) || len(command.RequestChecksum) != 32 {
		return StudentBatchAffiliation{}, apperrors.New(apperrors.CodeInvalidArgument, "student batch affiliation fields are invalid")
	}
	var affiliation StudentBatchAffiliation
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		affiliation, err = service.store.SetStudentBatchAffiliation(contextValue, transaction, command)
		return err
	})
	return affiliation, err
}

// GetStudentBatchAffiliation returns the stable current-row version callers
// need before issuing an optimistic set or revoke command.
func (service *ManagementService) GetStudentBatchAffiliation(contextValue context.Context, capability centralauthz.Capability, command GetStudentBatchAffiliation) (StudentBatchAffiliation, error) {
	command.TenantID = strings.ToLower(strings.TrimSpace(command.TenantID))
	command.StudentID = strings.ToLower(strings.TrimSpace(command.StudentID))
	if !isUUID(command.TenantID) || !isUUID(command.StudentID) {
		return StudentBatchAffiliation{}, apperrors.New(apperrors.CodeInvalidArgument, "student batch affiliation IDs are invalid")
	}
	var affiliation StudentBatchAffiliation
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		affiliation, err = service.store.GetStudentBatchAffiliation(contextValue, transaction, command)
		return err
	})
	return affiliation, err
}

// EndStudentBatchAffiliation keeps the historical membership interval and
// records an inactive current state with a new optimistic version.
func (service *ManagementService) EndStudentBatchAffiliation(contextValue context.Context, capability centralauthz.Capability, command EndStudentBatchAffiliation) (StudentBatchAffiliation, error) {
	command.TenantID = strings.ToLower(strings.TrimSpace(command.TenantID))
	command.StudentID = strings.ToLower(strings.TrimSpace(command.StudentID))
	command.ActorID = strings.ToLower(strings.TrimSpace(command.ActorID))
	command.IdempotencyKey = strings.ToLower(strings.TrimSpace(command.IdempotencyKey))
	if !isUUID(command.TenantID) || !isUUID(command.StudentID) || command.ExpectedVersion <= 0 ||
		!isUUID(command.ActorID) || !isUUID(command.IdempotencyKey) || len(command.RequestChecksum) != 32 {
		return StudentBatchAffiliation{}, apperrors.New(apperrors.CodeInvalidArgument, "student batch affiliation fields are invalid")
	}
	var affiliation StudentBatchAffiliation
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		affiliation, err = service.store.EndStudentBatchAffiliation(contextValue, transaction, command)
		return err
	})
	return affiliation, err
}

func (service *ManagementService) GetStudent(contextValue context.Context, capability centralauthz.Capability, studentID string) (Student, error) {
	if !isUUID(studentID) {
		return Student{}, apperrors.New(apperrors.CodeInvalidArgument, "student ID must be a UUID")
	}
	var student Student
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		student, err = service.store.GetStudent(contextValue, transaction, studentID)
		return err
	})
	return student, err
}

// DeleteStudent performs soft delete (default for all authorized roles).
// Authorization is enforced at the HTTP layer and via RLS.
func (service *ManagementService) DeleteStudent(contextValue context.Context, capability centralauthz.Capability, command DeleteStudent) error {
	command.Reason = strings.TrimSpace(command.Reason)
	if !isUUID(command.ID) || !isUUID(command.ActorID) || command.Reason == "" {
		return apperrors.New(apperrors.CodeInvalidArgument, "student ID, actor ID, and deletion reason are required")
	}

	return database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		// Verify student exists
		_, err := service.store.GetStudent(contextValue, transaction, command.ID)
		if err != nil {
			return fmt.Errorf("get student: %w", err)
		}

		// Perform soft delete
		if err := service.store.SoftDeleteStudent(contextValue, transaction, command); err != nil {
			return fmt.Errorf("soft delete student: %w", err)
		}

		return nil
	})
}

// HardDeleteStudent permanently removes student (SuperAdmin only).
// Authorization is enforced at both HTTP layer and domain layer.
func (service *ManagementService) HardDeleteStudent(contextValue context.Context, capability centralauthz.Capability, command DeleteStudent) error {
	command.Reason = strings.TrimSpace(command.Reason)
	if !isUUID(command.ID) || !isUUID(command.ActorID) || command.Reason == "" {
		return apperrors.New(apperrors.CodeInvalidArgument, "student ID, actor ID, and deletion reason are required")
	}

	return database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		// Verify student exists (including soft-deleted)
		_, err := service.store.GetStudentIncludeDeleted(contextValue, transaction, command.ID)
		if err != nil {
			return fmt.Errorf("get student: %w", err)
		}

		// Perform hard delete
		if err := service.store.HardDeleteStudent(contextValue, transaction, command); err != nil {
			return fmt.Errorf("hard delete student: %w", err)
		}

		return nil
	})
}

func validName(value string) bool {
	length := len([]rune(strings.TrimSpace(value)))
	return length >= 1 && length <= 120
}

func validEnrollmentNumber(value string) bool {
	length := len([]rune(value))
	return length >= 1 && length <= 128 && enrollmentPattern.MatchString(value)
}

func isUUID(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) != 36 {
		return false
	}
	for index, character := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			if character != '-' {
				return false
			}
			continue
		}
		//nolint:staticcheck // QF1001: the negated-range form reads more clearly for character validation
		if !(character >= '0' && character <= '9') && !(character >= 'a' && character <= 'f') {
			return false
		}
	}
	return true
}

func expired(value *time.Time) bool {
	return value != nil && !value.After(time.Now().UTC())
}

func validRoleScope(command AssignRole) bool {
	if command.RoleName != "super_admin" && command.RoleName != "placement_user" && command.RoleName != "college_admin" && command.RoleName != "department_user" && command.RoleName != "mentor" && command.RoleName != "student" {
		return false
	}
	switch command.ScopeKind {
	case "platform":
		return command.TenantID == "" && command.ScopeID == "" && (command.RoleName == "super_admin" || command.RoleName == "placement_user")
	case "college":
		return isUUID(command.TenantID) && command.ScopeID == command.TenantID && command.RoleName == "college_admin"
	case "department":
		return isUUID(command.TenantID) && isUUID(command.ScopeID) && (command.RoleName == "department_user" || command.RoleName == "mentor")
	case "batch":
		return isUUID(command.TenantID) && isUUID(command.ScopeID) && command.RoleName == "mentor"
	case "placement_department":
		return command.TenantID == "" && isUUID(command.ScopeID) && command.RoleName == "placement_user"
	case "self":
		return isUUID(command.TenantID) && command.ScopeID == command.PrincipalID && command.RoleName == "student"
	default:
		return false
	}
}
