package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	accountTenantID = "019b11a0-0000-7000-8000-000000000010"
	accountBatchID  = "019b11a0-0000-7000-8000-000000000011"
	accountDeptID   = "019b11a0-0000-7000-8000-000000000012"
	accountPlaceID  = "019b11a0-0000-7000-8000-000000000013"
	accountActorID  = "019b11a0-0000-7000-8000-000000000014"
	accountOtherID  = "019b11a0-0000-7000-8000-000000000015"
)

var errAuthorizeCalled = errors.New("authorize called")

// refuseAuthorize fails the test path at the first capability request, so a
// test can prove validation rejected the input before any authorization,
// database, or Identity work.
func refuseAuthorize(context.Context) (centralauthz.Capability, error) {
	return centralauthz.Capability{}, errAuthorizeCalled
}

type unusedAccountStore struct{}

func (unusedAccountStore) ExistingEnrollmentNumbers(context.Context, pgx.Tx, StudentImport, []string) ([]string, error) {
	return nil, nil
}
func (unusedAccountStore) ImportStudents(context.Context, pgx.Tx, StudentImport, string, []IssuedCredential, []string) ([]Student, error) {
	return nil, nil
}
func (unusedAccountStore) TenantAccountPrincipals(context.Context, pgx.Tx, string, []string) ([]string, error) {
	return nil, nil
}
func (unusedAccountStore) BatchAccountPrincipals(context.Context, pgx.Tx, string, string) ([]string, error) {
	return nil, nil
}
func (unusedAccountStore) GrantStaffRole(context.Context, pgx.Tx, StaffAccount, string, string) (RoleAssignment, error) {
	return RoleAssignment{}, nil
}

type unusedAccounts struct{}

func (unusedAccounts) ProvisionAccounts(context.Context, []AccountRequest, AccountAudit) ([]IssuedCredential, error) {
	return nil, errors.New("identity called")
}
func (unusedAccounts) ReissuePasswords(context.Context, []string, AccountAudit) ([]IssuedCredential, error) {
	return nil, errors.New("identity called")
}
func (unusedAccounts) SetAccountStatus(context.Context, []string, string, AccountAudit) error {
	return errors.New("identity called")
}
func (unusedAccounts) DiscardAccounts(context.Context, []string, AccountAudit) error {
	return errors.New("identity called")
}

func newTestAccountService(t *testing.T) *AccountService {
	t.Helper()
	service, err := NewAccountService(&pgxpool.Pool{}, unusedAccountStore{}, unusedAccounts{})
	if err != nil {
		t.Fatalf("NewAccountService() error = %v", err)
	}
	return service
}

func TestImportStudentsRejectsInvalidFilesBeforeAuthorization(t *testing.T) {
	t.Parallel()
	valid := StudentRow{RollNumber: "22CS001", Name: "Asha Kumar"}
	for name, scenario := range map[string]struct {
		rows    []StudentRow
		message string
	}{
		"empty file":         {rows: nil, message: "between 1 and"},
		"too many rows":      {rows: make([]StudentRow, MaxStudentImport+1), message: "between 1 and"},
		"roll with space":    {rows: []StudentRow{{RollNumber: "22 CS 001", Name: "A"}}, message: "row 1"},
		"roll with slash":    {rows: []StudentRow{valid, {RollNumber: "21/CS/2", Name: "B"}}, message: "row 2"},
		"missing name":       {rows: []StudentRow{{RollNumber: "22CS002"}}, message: "name is required"},
		"duplicate any case": {rows: []StudentRow{valid, {RollNumber: "22cs001", Name: "B"}}, message: "more than once"},
	} {
		_, err := newTestAccountService(t).ImportStudents(context.Background(), refuseAuthorize, accountActorID, StudentImport{
			TenantID: accountTenantID, BatchID: accountBatchID, CollegeDepartmentID: accountDeptID,
			PlacementDepartmentID: accountPlaceID, Students: scenario.rows,
		})
		if err == nil || errors.Is(err, errAuthorizeCalled) || !strings.Contains(err.Error(), scenario.message) {
			t.Fatalf("%s: error = %v, want validation error containing %q", name, err, scenario.message)
		}
	}
}

func TestCreateStaffRequiresAKnownRoleShape(t *testing.T) {
	t.Parallel()
	for name, command := range map[string]StaffAccount{
		"unknown role":               {TenantID: accountTenantID, Role: "super_admin"},
		"admin with department":      {TenantID: accountTenantID, Role: "college_admin", DepartmentID: accountDeptID},
		"faculty without department": {TenantID: accountTenantID, Role: "department_user"},
	} {
		if _, err := newTestAccountService(t).CreateStaff(context.Background(), refuseAuthorize, accountActorID, command); err == nil || errors.Is(err, errAuthorizeCalled) {
			t.Fatalf("%s: error = %v, want validation error before authorization", name, err)
		}
	}
}

func TestSetAccountStatusRejectsSelfAndUnknownStatus(t *testing.T) {
	t.Parallel()
	service := newTestAccountService(t)
	if err := service.SetAccountStatus(context.Background(), refuseAuthorize, accountActorID, accountTenantID, accountActorID, "disabled"); err == nil || errors.Is(err, errAuthorizeCalled) {
		t.Fatalf("self-disable error = %v, want validation error", err)
	}
	if err := service.SetAccountStatus(context.Background(), refuseAuthorize, accountActorID, accountTenantID, accountOtherID, "locked"); err == nil || errors.Is(err, errAuthorizeCalled) {
		t.Fatalf("unknown status error = %v, want validation error", err)
	}
}
