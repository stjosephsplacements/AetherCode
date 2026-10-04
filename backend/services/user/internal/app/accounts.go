package app

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MaxStudentImport matches Identity's per-call provisioning bound.
const MaxStudentImport = 500

// usernamePattern is Identity's username rule. A student's username is the
// lowercase roll number, so a roll number must satisfy it.
var usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)

// Accounts is the port to Identity's private account endpoints (ADR-0019).
type Accounts interface {
	ProvisionAccounts(context.Context, []AccountRequest, AccountAudit) ([]IssuedCredential, error)
	ReissuePasswords(context.Context, []string, AccountAudit) ([]IssuedCredential, error)
	SetAccountStatus(context.Context, []string, string, AccountAudit) error
	DiscardAccounts(context.Context, []string, AccountAudit) error
}

// AccountStore owns the college-membership side of account management. Its
// methods run inside a transaction bound to one users.accounts capability.
type AccountStore interface {
	ExistingEnrollmentNumbers(context.Context, pgx.Tx, StudentImport, []string) ([]string, error)
	ImportStudents(context.Context, pgx.Tx, StudentImport, string, []IssuedCredential, []string) ([]Student, error)
	TenantAccountPrincipals(context.Context, pgx.Tx, string, []string) ([]string, error)
	BatchAccountPrincipals(context.Context, pgx.Tx, string, string) ([]string, error)
	GrantStaffRole(context.Context, pgx.Tx, StaffAccount, string, string) (RoleAssignment, error)
}

// Authorize returns a fresh users.accounts write capability for the current
// request. A capability is single-use and short-lived, so a command that
// waits on Identity asks for a second one before its own transaction.
type Authorize func(context.Context) (centralauthz.Capability, error)

type AccountRequest struct {
	Username    string `json:"username"`
	Email       string `json:"email,omitempty"`
	DisplayName string `json:"display_name"`
}

type AccountAudit struct {
	ActorID   string `json:"actor_id"`
	RequestID string `json:"request_id"`
}

// IssuedCredential is a generated password, returned once and never stored.
type IssuedCredential struct {
	PrincipalID string `json:"principal_id"`
	Username    string `json:"username,omitempty"`
	DisplayName string `json:"display_name"`
	Password    string `json:"password"`
}

type StudentRow struct {
	RollNumber string `json:"roll_number"`
	Name       string `json:"name"`
	Email      string `json:"email,omitempty"`
}

type StudentImport struct {
	TenantID              string
	BatchID               string
	CollegeDepartmentID   string
	PlacementDepartmentID string
	Students              []StudentRow
}

// ImportedStudent is one row of the credentials sheet an administrator
// downloads or prints as login slips.
type ImportedStudent struct {
	StudentID   string `json:"student_id"`
	PrincipalID string `json:"principal_id"`
	RollNumber  string `json:"roll_number"`
	Name        string `json:"name"`
	Username    string `json:"username"`
	Password    string `json:"password"`
}

type StudentImportResult struct {
	Imported []ImportedStudent `json:"imported"`
	Skipped  []string          `json:"skipped"`
}

type StaffAccount struct {
	TenantID     string
	Username     string
	Email        string
	DisplayName  string
	Role         string
	DepartmentID string
}

type StaffAccountResult struct {
	IssuedCredential
	RoleAssignment RoleAssignment `json:"role_assignment"`
}

// AccountService coordinates Identity credentials with college membership.
type AccountService struct {
	pool     *pgxpool.Pool
	store    AccountStore
	identity Accounts
	newID    func() (string, error)
}

func NewAccountService(pool *pgxpool.Pool, store AccountStore, identity Accounts) (*AccountService, error) {
	if pool == nil || store == nil || identity == nil {
		return nil, fmt.Errorf("user database pool, account store, and Identity accounts client are required")
	}
	return &AccountService{pool: pool, store: store, identity: identity, newID: database.NewUUIDv7}, nil
}

// ImportStudents creates accounts with generated passwords for every new roll
// number, enrolls them in the college and places them in the batch. Roll
// numbers the college already has are skipped; any invalid row rejects the
// whole file, so nothing is half-imported.
func (service *AccountService) ImportStudents(contextValue context.Context, authorize Authorize, actorID string, command StudentImport) (StudentImportResult, error) {
	if !isUUID(command.TenantID) || !isUUID(command.BatchID) || !isUUID(command.CollegeDepartmentID) ||
		!isUUID(command.PlacementDepartmentID) || !isUUID(actorID) {
		return StudentImportResult{}, apperrors.New(apperrors.CodeInvalidArgument, "tenant, batch, department, and actor IDs must be UUIDs")
	}
	if len(command.Students) == 0 || len(command.Students) > MaxStudentImport {
		return StudentImportResult{}, apperrors.New(apperrors.CodeInvalidArgument, fmt.Sprintf("between 1 and %d students are required", MaxStudentImport))
	}
	numbers := make([]string, len(command.Students))
	seen := make(map[string]bool, len(command.Students))
	for index, row := range command.Students {
		row.RollNumber, row.Name, row.Email = strings.TrimSpace(row.RollNumber), strings.TrimSpace(row.Name), strings.TrimSpace(row.Email)
		username := strings.ToLower(row.RollNumber)
		if !validEnrollmentNumber(row.RollNumber) || !usernamePattern.MatchString(username) {
			return StudentImportResult{}, apperrors.New(apperrors.CodeInvalidArgument, fmt.Sprintf("row %d: roll number %q may use only letters, digits, '.', '_' and '-'", index+1, row.RollNumber))
		}
		if length := len([]rune(row.Name)); length < 1 || length > 200 {
			return StudentImportResult{}, apperrors.New(apperrors.CodeInvalidArgument, fmt.Sprintf("row %d: name is required (at most 200 characters)", index+1))
		}
		if seen[username] {
			return StudentImportResult{}, apperrors.New(apperrors.CodeInvalidArgument, fmt.Sprintf("row %d: roll number %q appears more than once", index+1, row.RollNumber))
		}
		seen[username] = true
		command.Students[index], numbers[index] = row, row.RollNumber
	}

	var existing []string
	if err := service.inAccountTx(contextValue, authorize, func(transaction pgx.Tx) error {
		var err error
		existing, err = service.store.ExistingEnrollmentNumbers(contextValue, transaction, command, numbers)
		return err
	}); err != nil {
		return StudentImportResult{}, err
	}
	skip := make(map[string]bool, len(existing))
	for _, number := range existing {
		skip[number] = true
	}
	result := StudentImportResult{Imported: []ImportedStudent{}, Skipped: []string{}}
	var rows []StudentRow
	var requests []AccountRequest
	for _, row := range command.Students {
		if skip[row.RollNumber] {
			result.Skipped = append(result.Skipped, row.RollNumber)
			continue
		}
		rows = append(rows, row)
		requests = append(requests, AccountRequest{Username: strings.ToLower(row.RollNumber), Email: row.Email, DisplayName: row.Name})
	}
	if len(rows) == 0 {
		return result, nil
	}

	audit, err := service.audit(actorID)
	if err != nil {
		return StudentImportResult{}, err
	}
	credentials, err := service.identity.ProvisionAccounts(contextValue, requests, audit)
	if err != nil {
		return StudentImportResult{}, err
	}
	rollNumbers := make([]string, len(rows))
	for index, row := range rows {
		rollNumbers[index] = row.RollNumber
	}
	var students []Student
	err = service.inAccountTx(contextValue, authorize, func(transaction pgx.Tx) error {
		var err error
		students, err = service.store.ImportStudents(contextValue, transaction, command, actorID, credentials, rollNumbers)
		return err
	})
	if err != nil {
		service.discard(contextValue, credentials, audit)
		return StudentImportResult{}, err
	}
	for index, student := range students {
		result.Imported = append(result.Imported, ImportedStudent{
			StudentID: student.ID, PrincipalID: student.PrincipalID, RollNumber: student.EnrollmentNumber,
			Name: rows[index].Name, Username: credentials[index].Username, Password: credentials[index].Password,
		})
	}
	return result, nil
}

// ReissueBatchPasswords gives every student in the batch a new password and
// signs them out, for when login slips are lost.
func (service *AccountService) ReissueBatchPasswords(contextValue context.Context, authorize Authorize, actorID, tenantID, batchID string) ([]IssuedCredential, error) {
	if !isUUID(tenantID) || !isUUID(batchID) || !isUUID(actorID) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "tenant, batch, and actor IDs must be UUIDs")
	}
	var principalIDs []string
	if err := service.inAccountTx(contextValue, authorize, func(transaction pgx.Tx) error {
		var err error
		principalIDs, err = service.store.BatchAccountPrincipals(contextValue, transaction, tenantID, batchID)
		return err
	}); err != nil {
		return nil, err
	}
	if len(principalIDs) == 0 {
		return []IssuedCredential{}, nil
	}
	audit, err := service.audit(actorID)
	if err != nil {
		return nil, err
	}
	return service.identity.ReissuePasswords(contextValue, principalIDs, audit)
}

// ResetPassword gives one student or staff member of the college a new
// generated password and signs them out.
func (service *AccountService) ResetPassword(contextValue context.Context, authorize Authorize, actorID, tenantID, principalID string) (IssuedCredential, error) {
	audit, err := service.requireTenantAccount(contextValue, authorize, actorID, tenantID, principalID)
	if err != nil {
		return IssuedCredential{}, err
	}
	credentials, err := service.identity.ReissuePasswords(contextValue, []string{principalID}, audit)
	if err != nil {
		return IssuedCredential{}, err
	}
	if len(credentials) != 1 {
		return IssuedCredential{}, fmt.Errorf("identity returned %d credentials for one account", len(credentials))
	}
	return credentials[0], nil
}

// SetAccountStatus enables or disables one student or staff member of the
// college. Disabling signs the account out at once.
func (service *AccountService) SetAccountStatus(contextValue context.Context, authorize Authorize, actorID, tenantID, principalID, status string) error {
	if status != "active" && status != "disabled" {
		return apperrors.New(apperrors.CodeInvalidArgument, "status must be active or disabled")
	}
	if principalID == actorID {
		return apperrors.New(apperrors.CodeInvalidArgument, "you cannot change the status of your own account")
	}
	audit, err := service.requireTenantAccount(contextValue, authorize, actorID, tenantID, principalID)
	if err != nil {
		return err
	}
	return service.identity.SetAccountStatus(contextValue, []string{principalID}, status, audit)
}

// CreateStaff provisions a college administrator or a department's faculty
// account with a generated password.
func (service *AccountService) CreateStaff(contextValue context.Context, authorize Authorize, actorID string, command StaffAccount) (StaffAccountResult, error) {
	command.DepartmentID = strings.ToLower(strings.TrimSpace(command.DepartmentID))
	validRole := command.Role == "college_admin" && command.DepartmentID == "" ||
		command.Role == "department_user" && isUUID(command.DepartmentID)
	if !isUUID(command.TenantID) || !isUUID(actorID) || !validRole {
		return StaffAccountResult{}, apperrors.New(apperrors.CodeInvalidArgument, "role must be college_admin, or department_user with a department ID")
	}
	// Authorize before Identity creates anything; the grant itself runs under
	// a second capability once the account exists.
	if _, err := authorize(contextValue); err != nil {
		return StaffAccountResult{}, err
	}
	audit, err := service.audit(actorID)
	if err != nil {
		return StaffAccountResult{}, err
	}
	credentials, err := service.identity.ProvisionAccounts(contextValue, []AccountRequest{{
		Username: command.Username, Email: command.Email, DisplayName: command.DisplayName,
	}}, audit)
	if err != nil {
		return StaffAccountResult{}, err
	}
	if len(credentials) != 1 {
		return StaffAccountResult{}, fmt.Errorf("identity returned %d credentials for one account", len(credentials))
	}
	var assignment RoleAssignment
	err = service.inAccountTx(contextValue, authorize, func(transaction pgx.Tx) error {
		var err error
		assignment, err = service.store.GrantStaffRole(contextValue, transaction, command, credentials[0].PrincipalID, actorID)
		return err
	})
	if err != nil {
		service.discard(contextValue, credentials, audit)
		return StaffAccountResult{}, err
	}
	return StaffAccountResult{IssuedCredential: credentials[0], RoleAssignment: assignment}, nil
}

func (service *AccountService) requireTenantAccount(contextValue context.Context, authorize Authorize, actorID, tenantID, principalID string) (AccountAudit, error) {
	if !isUUID(tenantID) || !isUUID(principalID) || !isUUID(actorID) {
		return AccountAudit{}, apperrors.New(apperrors.CodeInvalidArgument, "tenant, principal, and actor IDs must be UUIDs")
	}
	var manageable []string
	if err := service.inAccountTx(contextValue, authorize, func(transaction pgx.Tx) error {
		var err error
		manageable, err = service.store.TenantAccountPrincipals(contextValue, transaction, tenantID, []string{principalID})
		return err
	}); err != nil {
		return AccountAudit{}, err
	}
	if len(manageable) != 1 {
		return AccountAudit{}, apperrors.New(apperrors.CodeNotFound, "account not found in this college")
	}
	return service.audit(actorID)
}

func (service *AccountService) inAccountTx(contextValue context.Context, authorize Authorize, work func(pgx.Tx) error) error {
	capability, err := authorize(contextValue)
	if err != nil {
		return err
	}
	return database.WithTenantTx(contextValue, service.pool, capability, work)
}

func (service *AccountService) audit(actorID string) (AccountAudit, error) {
	requestID, err := service.newID()
	if err != nil {
		return AccountAudit{}, err
	}
	return AccountAudit{ActorID: actorID, RequestID: requestID}, nil
}

// discard frees the usernames of accounts whose college membership could not
// be recorded. It outlives a cancelled request so a retry can succeed.
func (service *AccountService) discard(contextValue context.Context, credentials []IssuedCredential, audit AccountAudit) {
	ids := make([]string, len(credentials))
	for index, credential := range credentials {
		ids[index] = credential.PrincipalID
	}
	discardContext, cancel := context.WithTimeout(context.WithoutCancel(contextValue), 10*time.Second)
	defer cancel()
	if err := service.identity.DiscardAccounts(discardContext, ids, audit); err != nil {
		// The accounts stay unusable (no college membership grants access), but
		// their usernames stay taken until an operator removes them.
		slog.ErrorContext(contextValue, "discard provisioned accounts", "request_id", audit.RequestID,
			"principal_ids", ids, "error", err)
	}
}
