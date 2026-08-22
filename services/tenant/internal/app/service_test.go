package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type panicStore struct{}

func (panicStore) ProvisionTenant(context.Context, pgx.Tx, ProvisionTenant) (Tenant, error) {
	panic("unexpected persistence call")
}
func (panicStore) GetTenant(context.Context, pgx.Tx, string) (Tenant, error) {
	panic("unexpected persistence call")
}
func (panicStore) CreatePlacementOrganization(context.Context, pgx.Tx, CreatePlacementOrganization) (PlacementOrganization, error) {
	panic("unexpected persistence call")
}
func (panicStore) CreateCollegeDepartment(context.Context, pgx.Tx, CreateCollegeDepartment) (Department, error) {
	panic("unexpected persistence call")
}
func (panicStore) CreatePlacementDepartment(context.Context, pgx.Tx, CreatePlacementDepartment) (Department, error) {
	panic("unexpected persistence call")
}
func (panicStore) CreateBatch(context.Context, pgx.Tx, CreateBatch) (Batch, error) {
	panic("unexpected persistence call")
}
func (panicStore) SetRetentionPolicy(context.Context, pgx.Tx, SetRetentionPolicy) (RetentionPolicy, error) {
	panic("unexpected persistence call")
}
func (panicStore) PlaceLegalHold(context.Context, pgx.Tx, PlaceLegalHold) (LegalHold, error) {
	panic("unexpected persistence call")
}
func (panicStore) ReleaseLegalHold(context.Context, pgx.Tx, ReleaseLegalHold) (LegalHold, error) {
	panic("unexpected persistence call")
}
func (panicStore) GetTenantIncludeDeleted(context.Context, pgx.Tx, string) (Tenant, error) {
	panic("unexpected persistence call")
}
func (panicStore) SoftDeleteTenant(context.Context, pgx.Tx, DeleteEntity) error {
	panic("unexpected persistence call")
}
func (panicStore) HardDeleteTenant(context.Context, pgx.Tx, DeleteEntity) error {
	panic("unexpected persistence call")
}
func (panicStore) GetPlacementOrganization(context.Context, pgx.Tx, string) (PlacementOrganization, error) {
	panic("unexpected persistence call")
}
func (panicStore) GetPlacementOrganizationIncludeDeleted(context.Context, pgx.Tx, string) (PlacementOrganization, error) {
	panic("unexpected persistence call")
}
func (panicStore) SoftDeletePlacementOrganization(context.Context, pgx.Tx, DeleteEntity) error {
	panic("unexpected persistence call")
}
func (panicStore) HardDeletePlacementOrganization(context.Context, pgx.Tx, DeleteEntity) error {
	panic("unexpected persistence call")
}
func (panicStore) GetDepartment(context.Context, pgx.Tx, string) (Department, error) {
	panic("unexpected persistence call")
}
func (panicStore) GetDepartmentIncludeDeleted(context.Context, pgx.Tx, string) (Department, error) {
	panic("unexpected persistence call")
}
func (panicStore) SoftDeleteDepartment(context.Context, pgx.Tx, DeleteEntity) error {
	panic("unexpected persistence call")
}
func (panicStore) HardDeleteDepartment(context.Context, pgx.Tx, DeleteEntity) error {
	panic("unexpected persistence call")
}
func (panicStore) GetBatch(context.Context, pgx.Tx, string) (Batch, error) {
	panic("unexpected persistence call")
}
func (panicStore) GetBatchIncludeDeleted(context.Context, pgx.Tx, string) (Batch, error) {
	panic("unexpected persistence call")
}
func (panicStore) SoftDeleteBatch(context.Context, pgx.Tx, DeleteEntity) error {
	panic("unexpected persistence call")
}
func (panicStore) HardDeleteBatch(context.Context, pgx.Tx, DeleteEntity) error {
	panic("unexpected persistence call")
}
func (panicStore) ListTenants(context.Context, pgx.Tx, ListTenants) ([]Tenant, error) {
	panic("unexpected persistence call")
}
func (panicStore) ListDepartments(context.Context, pgx.Tx, ListDepartments) ([]Department, error) {
	panic("unexpected persistence call")
}
func (panicStore) ListPlacementOrganizations(context.Context, pgx.Tx, ListPlacementOrganizations) ([]PlacementOrganization, error) {
	panic("unexpected persistence call")
}
func (panicStore) ListPlacementDepartments(context.Context, pgx.Tx, ListPlacementDepartments) ([]Department, error) {
	panic("unexpected persistence call")
}
func (panicStore) ListBatches(context.Context, pgx.Tx, ListBatches) ([]Batch, error) {
	panic("unexpected persistence call")
}
func (panicStore) Ping(context.Context) error { panic("unexpected persistence call") }

const testUUID = "550e8400-e29b-41d4-a716-446655440000"

func assertInvalidArgument(t *testing.T, err error) {
	t.Helper()
	var appErr *apperrors.Error
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid_argument", err)
	}
}

func TestProvisionTenantRejectsInvalidSlug(t *testing.T) {
	t.Parallel()
	service := &Service{pool: &pgxpool.Pool{}, store: panicStore{}}
	// After ToLower+TrimSpace: slug must match ^[a-z0-9][a-z0-9-]{1,62}$
	// "Tenant" lowercases to "tenant" which is valid. Use truly invalid inputs.
	for _, slug := range []string{
		"a",                     // too short (needs 3+ chars total: first + 1..62)
		"-tenant",               // starts with hyphen
		"my tenant",             // contains space
		"my_tenant",             // contains underscore
		"",                      // empty
		"tenant@example",        // special characters
		strings.Repeat("a", 64), // too long (max 63)
	} {
		_, err := service.ProvisionTenant(context.Background(), centralauthz.Capability{}, ProvisionTenant{
			Slug: slug, LegalName: "Valid Legal Name", DisplayName: "Valid Display",
		})
		assertInvalidArgument(t, err)
	}
}

func TestProvisionTenantRejectsMissingOrOversizeNames(t *testing.T) {
	t.Parallel()
	service := &Service{pool: &pgxpool.Pool{}, store: panicStore{}}
	for _, testCase := range []struct {
		legal   string
		display string
	}{
		{"", "Display"},
		{"Legal", ""},
		{"   ", "Display"},
		{"Legal", "   "},
		{strings.Repeat("x", 256), "Display"},
		{"Legal", strings.Repeat("x", 256)},
	} {
		_, err := service.ProvisionTenant(context.Background(), centralauthz.Capability{}, ProvisionTenant{
			Slug: "valid-slug", LegalName: testCase.legal, DisplayName: testCase.display,
		})
		assertInvalidArgument(t, err)
	}
}

func TestCreatePlacementOrganizationRejectsInvalidCode(t *testing.T) {
	t.Parallel()
	service := &Service{pool: &pgxpool.Pool{}, store: panicStore{}}
	// Pattern: ^[A-Z0-9][A-Z0-9-]{1,62}$ applied after ToUpper+TrimSpace.
	// "google" uppercases to "GOOGLE" which matches. Use truly invalid inputs.
	for _, code := range []string{
		"-GOOGLE",               // starts with hyphen
		"G",                     // too short (needs 2-63)
		"",                      // empty
		"GOOGLE INC",            // contains space
		"GOOGLE_INC",            // contains underscore
		strings.Repeat("A", 64), // too long
	} {
		_, err := service.CreatePlacementOrganization(context.Background(), centralauthz.Capability{}, CreatePlacementOrganization{
			Code: code, LegalName: "Valid Legal Name",
		})
		assertInvalidArgument(t, err)
	}
}

func TestCreateCollegeDepartmentRejectsMissingTenantOrBadCode(t *testing.T) {
	t.Parallel()
	service := &Service{pool: &pgxpool.Pool{}, store: panicStore{}}
	// Pattern: ^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$ — allows underscores/hyphens.
	for _, testCase := range []struct {
		tenantID string
		code     string
	}{
		{"", "CS"},
		{"not-a-uuid", "CS"},
		{testUUID, ""},
		{testUUID, "C"},                     // too short (needs 2-63)
		{testUUID, "-CS"},                   // starts with hyphen
		{testUUID, "CS DEPT"},               // contains space (not trimmed out)
		{testUUID, strings.Repeat("A", 64)}, // too long
	} {
		_, err := service.CreateCollegeDepartment(context.Background(), centralauthz.Capability{}, CreateCollegeDepartment{
			TenantID: testCase.tenantID, Code: testCase.code, Name: "Computer Science",
		})
		assertInvalidArgument(t, err)
	}
}

func TestCreatePlacementDepartmentRejectsMissingOrganizationID(t *testing.T) {
	t.Parallel()
	service := &Service{pool: &pgxpool.Pool{}, store: panicStore{}}
	for _, orgID := range []string{"", "not-a-uuid", "550e8400-e29b-41d4-a716"} {
		_, err := service.CreatePlacementDepartment(context.Background(), centralauthz.Capability{}, CreatePlacementDepartment{
			PlacementOrganizationID: orgID, Code: "Engineering", Name: "Engineering Department",
		})
		assertInvalidArgument(t, err)
	}
}

func TestCreateBatchRejectsInvalidAcademicYear(t *testing.T) {
	t.Parallel()
	service := &Service{pool: &pgxpool.Pool{}, store: panicStore{}}
	for _, year := range []string{
		"2026",
		"26-27",
		"abcd-efgh",
		"20262027",
		"",
		"2026/2027",
		"202-203",
	} {
		_, err := service.CreateBatch(context.Background(), centralauthz.Capability{}, CreateBatch{
			TenantID: testUUID, DepartmentID: testUUID, Code: "Batch2026", Name: "Batch 2026", AcademicYear: year,
		})
		assertInvalidArgument(t, err)
	}
}

func TestRetentionPolicyRejectsBoundsViolations(t *testing.T) {
	t.Parallel()
	service := &Service{pool: &pgxpool.Pool{}, store: panicStore{}}
	base := SetRetentionPolicy{
		TenantID: testUUID, AcademicRecordsYears: 10, AuditRecordsYears: 10,
		AuthLogsDays: 180, NotificationDeliveryDays: 90, ExecutionRecordDays: 30,
	}
	for _, modify := range []func(SetRetentionPolicy) SetRetentionPolicy{
		func(c SetRetentionPolicy) SetRetentionPolicy { c.TenantID = "bad"; return c },
		func(c SetRetentionPolicy) SetRetentionPolicy { c.AcademicRecordsYears = 6; return c },
		func(c SetRetentionPolicy) SetRetentionPolicy { c.AcademicRecordsYears = 31; return c },
		func(c SetRetentionPolicy) SetRetentionPolicy { c.AuditRecordsYears = 6; return c },
		func(c SetRetentionPolicy) SetRetentionPolicy { c.AuditRecordsYears = 31; return c },
		func(c SetRetentionPolicy) SetRetentionPolicy { c.AuthLogsDays = 89; return c },
		func(c SetRetentionPolicy) SetRetentionPolicy { c.AuthLogsDays = 3651; return c },
		func(c SetRetentionPolicy) SetRetentionPolicy { c.NotificationDeliveryDays = 29; return c },
		func(c SetRetentionPolicy) SetRetentionPolicy { c.NotificationDeliveryDays = 3651; return c },
		func(c SetRetentionPolicy) SetRetentionPolicy { c.ExecutionRecordDays = 0; return c },
		func(c SetRetentionPolicy) SetRetentionPolicy { c.ExecutionRecordDays = 366; return c },
	} {
		_, err := service.SetRetentionPolicy(context.Background(), centralauthz.Capability{}, modify(base))
		assertInvalidArgument(t, err)
	}
}

func TestLegalHoldScopeAndSubjectRules(t *testing.T) {
	t.Parallel()
	service := &Service{pool: &pgxpool.Pool{}, store: panicStore{}}
	for _, testCase := range []struct {
		scope     string
		subjectID string
	}{
		{"tenant", testUUID},
		{"student", ""},
		{"assessment", ""},
		{"submission", ""},
		{"student", "not-a-uuid"},
		{"organization", testUUID},
		{"", testUUID},
	} {
		_, err := service.PlaceLegalHold(context.Background(), centralauthz.Capability{}, PlaceLegalHold{
			TenantID: testUUID, Scope: testCase.scope, SubjectID: testCase.subjectID,
			Reason: "Valid reason", PlacedByPrincipalID: testUUID,
		})
		assertInvalidArgument(t, err)
	}
}

func TestPlaceLegalHoldRejectsInvalidReason(t *testing.T) {
	t.Parallel()
	service := &Service{pool: &pgxpool.Pool{}, store: panicStore{}}
	for _, reason := range []string{"", "   ", strings.Repeat("x", 2001)} {
		_, err := service.PlaceLegalHold(context.Background(), centralauthz.Capability{}, PlaceLegalHold{
			TenantID: testUUID, Scope: "student", SubjectID: testUUID,
			Reason: reason, PlacedByPrincipalID: testUUID,
		})
		assertInvalidArgument(t, err)
	}
}

func TestReleaseLegalHoldRejectsInvalidIDs(t *testing.T) {
	t.Parallel()
	service := &Service{pool: &pgxpool.Pool{}, store: panicStore{}}
	for _, testCase := range []struct {
		id       string
		tenant   string
		released string
	}{
		{"not-a-uuid", testUUID, testUUID},
		{"", testUUID, testUUID},
		{testUUID, "not-a-uuid", testUUID},
		{testUUID, "", testUUID},
		{testUUID, testUUID, "not-a-uuid"},
		{testUUID, testUUID, ""},
	} {
		_, err := service.ReleaseLegalHold(context.Background(), centralauthz.Capability{}, ReleaseLegalHold{
			ID: testCase.id, TenantID: testCase.tenant, ReleasedByPrincipalID: testCase.released,
		})
		assertInvalidArgument(t, err)
	}
}

func TestGetPlacementOrganizationRejectsInvalidUUID(t *testing.T) {
	t.Parallel()
	service := &Service{pool: &pgxpool.Pool{}, store: panicStore{}}
	for _, id := range []string{"", "not-a-uuid", "550e8400-e29b-41d4-a716"} {
		_, err := service.GetPlacementOrganization(context.Background(), centralauthz.Capability{}, id)
		assertInvalidArgument(t, err)
	}
}

func TestListPlacementOrganizationsRejectsInvalidCursor(t *testing.T) {
	t.Parallel()
	service := &Service{pool: &pgxpool.Pool{}, store: panicStore{}}
	_, err := service.ListPlacementOrganizations(context.Background(), centralauthz.Capability{}, ListPlacementOrganizations{
		Limit: 20, CursorSort: "not-a-timestamp", CursorID: testUUID,
	})
	assertInvalidArgument(t, err)
}
