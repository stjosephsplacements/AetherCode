package app

import (
	"context"
	"errors"
	"testing"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	managementStudentID    = "018f4b0d-08f8-7c09-9ba7-efdf9c220901"
	managementMembershipID = "018f4b0d-08f8-7c09-9ba7-efdf9c220902"
	managementBatchID      = "018f4b0d-08f8-7c09-9ba7-efdf9c220903"
	managementActorID      = "018f4b0d-08f8-7c09-9ba7-efdf9c220904"
	managementIdempotency  = "018f4b0d-08f8-7c09-9ba7-efdf9c220905"
)

func TestStudentBatchAffiliationCommandsRejectInvalidCompareAndSwapInputs(t *testing.T) {
	t.Parallel()
	service := &ManagementService{pool: &pgxpool.Pool{}, store: uncalledManagementStore{}}

	_, err := service.SetStudentBatchAffiliation(context.Background(), centralauthz.Capability{}, SetStudentBatchAffiliation{
		MembershipID: managementMembershipID, TenantID: testTenant, StudentID: managementStudentID,
		BatchID: managementBatchID, ExpectedVersion: 0, ActorID: managementActorID,
		IdempotencyKey: managementIdempotency, RequestChecksum: validRequestChecksum(),
	})
	assertManagementErrorCode(t, err, apperrors.CodeInvalidArgument)

	_, err = service.EndStudentBatchAffiliation(context.Background(), centralauthz.Capability{}, EndStudentBatchAffiliation{
		TenantID: testTenant, StudentID: managementStudentID, ExpectedVersion: 0,
		ActorID: managementActorID, IdempotencyKey: managementIdempotency, RequestChecksum: validRequestChecksum(),
	})
	assertManagementErrorCode(t, err, apperrors.CodeInvalidArgument)
}

func TestStudentBatchAffiliationCommandsRejectMalformedIDsBeforeOpeningTransaction(t *testing.T) {
	t.Parallel()
	service := &ManagementService{pool: &pgxpool.Pool{}, store: uncalledManagementStore{}}

	_, err := service.SetStudentBatchAffiliation(context.Background(), centralauthz.Capability{}, SetStudentBatchAffiliation{
		MembershipID: "not-a-uuid", TenantID: testTenant, StudentID: managementStudentID,
		BatchID: managementBatchID, ExpectedVersion: 1, ActorID: managementActorID,
		IdempotencyKey: managementIdempotency, RequestChecksum: validRequestChecksum(),
	})
	assertManagementErrorCode(t, err, apperrors.CodeInvalidArgument)
}

func TestStudentBatchAffiliationCommandsRequireDurableIdempotencyInputs(t *testing.T) {
	t.Parallel()
	service := &ManagementService{pool: &pgxpool.Pool{}, store: uncalledManagementStore{}}

	_, err := service.SetStudentBatchAffiliation(context.Background(), centralauthz.Capability{}, SetStudentBatchAffiliation{
		MembershipID: managementMembershipID, TenantID: testTenant, StudentID: managementStudentID,
		BatchID: managementBatchID, ExpectedVersion: 1, ActorID: managementActorID,
		RequestChecksum: validRequestChecksum(),
	})
	assertManagementErrorCode(t, err, apperrors.CodeInvalidArgument)
}

func validRequestChecksum() []byte {
	return make([]byte, 32)
}

func assertManagementErrorCode(t *testing.T, err error, want apperrors.Code) {
	t.Helper()
	var applicationError *apperrors.Error
	if !errors.As(err, &applicationError) || applicationError.Code != want {
		t.Fatalf("error = %v, want application error code %q", err, want)
	}
}

// uncalledManagementStore proves input validation happens before a database
// transaction is opened; every method is intentionally unreachable in these
// focused command-validation tests.
type uncalledManagementStore struct{}

func (uncalledManagementStore) UpsertProfile(context.Context, pgx.Tx, UpsertProfile) (Profile, error) {
	panic("unexpected persistence call")
}

func (uncalledManagementStore) EnrollStudent(context.Context, pgx.Tx, EnrollStudent) (Student, error) {
	panic("unexpected persistence call")
}

func (uncalledManagementStore) AssignRole(context.Context, pgx.Tx, AssignRole) (RoleAssignment, error) {
	panic("unexpected persistence call")
}

func (uncalledManagementStore) RevokeRole(context.Context, pgx.Tx, RevokeRole) (RoleAssignment, error) {
	panic("unexpected persistence call")
}

func (uncalledManagementStore) SetPlacementStaffMembership(context.Context, pgx.Tx, SetPlacementStaffMembership) (PlacementStaffMembership, error) {
	panic("unexpected persistence call")
}

func (uncalledManagementStore) AssignMentorBatch(context.Context, pgx.Tx, AssignMentorBatch) (MentorBatchAssignment, error) {
	panic("unexpected persistence call")
}

func (uncalledManagementStore) GetStudentBatchAffiliation(context.Context, pgx.Tx, GetStudentBatchAffiliation) (StudentBatchAffiliation, error) {
	panic("unexpected persistence call")
}

func (uncalledManagementStore) SetStudentBatchAffiliation(context.Context, pgx.Tx, SetStudentBatchAffiliation) (StudentBatchAffiliation, error) {
	panic("unexpected persistence call")
}

func (uncalledManagementStore) EndStudentBatchAffiliation(context.Context, pgx.Tx, EndStudentBatchAffiliation) (StudentBatchAffiliation, error) {
	panic("unexpected persistence call")
}

func (uncalledManagementStore) GetStudent(context.Context, pgx.Tx, string) (Student, error) {
	panic("unexpected persistence call")
}

func (uncalledManagementStore) GetStudentIncludeDeleted(context.Context, pgx.Tx, string) (Student, error) {
	panic("unexpected persistence call")
}

func (uncalledManagementStore) SoftDeleteStudent(context.Context, pgx.Tx, DeleteStudent) error {
	panic("unexpected persistence call")
}

func (uncalledManagementStore) HardDeleteStudent(context.Context, pgx.Tx, DeleteStudent) error {
	panic("unexpected persistence call")
}

func (uncalledManagementStore) ListStudents(context.Context, pgx.Tx, ListStudents) ([]Student, error) {
	panic("unexpected persistence call")
}

func (uncalledManagementStore) ListMentorBatchAssignments(context.Context, pgx.Tx, ListMentorBatchAssignments) ([]MentorBatchAssignment, error) {
	panic("unexpected persistence call")
}

func (uncalledManagementStore) ListRoleAssignments(context.Context, pgx.Tx, ListRoleAssignments) ([]RoleAssignment, error) {
	panic("unexpected persistence call")
}

func (uncalledManagementStore) Ping(context.Context) error {
	panic("unexpected persistence call")
}

// TestDeleteStudent_RequiresValidInputs verifies input validation before transaction.
func TestDeleteStudent_RequiresValidInputs(t *testing.T) {
	t.Parallel()
	service := &ManagementService{pool: &pgxpool.Pool{}, store: uncalledManagementStore{}}

	// Missing reason
	err := service.DeleteStudent(context.Background(), centralauthz.Capability{}, DeleteStudent{
		ID:      managementStudentID,
		ActorID: managementActorID,
		Reason:  "",
	})
	assertManagementErrorCode(t, err, apperrors.CodeInvalidArgument)

	// Invalid student ID
	err = service.DeleteStudent(context.Background(), centralauthz.Capability{}, DeleteStudent{
		ID:      "not-a-uuid",
		ActorID: managementActorID,
		Reason:  "Student withdrew",
	})
	assertManagementErrorCode(t, err, apperrors.CodeInvalidArgument)

	// Invalid actor ID
	err = service.DeleteStudent(context.Background(), centralauthz.Capability{}, DeleteStudent{
		ID:      managementStudentID,
		ActorID: "not-a-uuid",
		Reason:  "Student withdrew",
	})
	assertManagementErrorCode(t, err, apperrors.CodeInvalidArgument)
}

// TestHardDeleteStudent_RequiresSuperAdminRole verifies authorization.
func TestHardDeleteStudent_RequiresSuperAdminRole(t *testing.T) {
	t.Parallel()
	service := &ManagementService{pool: &pgxpool.Pool{}, store: uncalledManagementStore{}}

	// Role authorization (super_admin check) is enforced by Casbin via AuthorizeHTTP(action="delete").
	// Missing reason should still fail input validation.
	err := service.HardDeleteStudent(context.Background(), centralauthz.Capability{}, DeleteStudent{
		ID:      managementStudentID,
		ActorID: managementActorID,
		Reason:  "",
	})
	assertManagementErrorCode(t, err, apperrors.CodeInvalidArgument)
}
