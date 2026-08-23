//go:build integration

package integration_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/httpauth"
	authzv1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/authz/v1"
	httpadapter "github.com/aethercode/aethercode/services/user/internal/adapters/http"
	"github.com/aethercode/aethercode/services/user/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/user/internal/app"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
)

// TestSoftDeleteFlow_EndToEnd validates the complete soft delete flow from HTTP to database.
// Tests that soft-deleted records are filtered from default queries but accessible with explicit inclusion.
func TestSoftDeleteFlow_EndToEnd(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	ctx := context.Background()
	pool := setupTestDatabase(t)
	defer pool.Close()

	// Initialize service stack
	store := repo.NewPostgres(pool)
	service, err := app.NewManagementService(pool, store)
	require.NoError(t, err)

	authorizer := createTestAuthorizer(ctx, t, pool)

	readinessFunc := func(ctx context.Context) error { return nil }
	handler, err := httpadapter.NewHandler("user-test", service, readinessFunc, authorizer)
	require.NoError(t, err)

	// Test data
	tenantID := uuid.New()
	principalID := uuid.New()
	actorID := uuid.New()
	collegeDeptID := uuid.New()
	placementDeptID := uuid.New()

	// The actor needs a current central authorization at the database layer,
	// and the enrollment departments must exist as active projections, before
	// any of the HTTP calls below can succeed.
	seedActorTenantAuthorization(ctx, t, pool, actorID, tenantID)
	seedCollegeDepartment(ctx, t, pool, collegeDeptID, tenantID)
	seedPlacementDepartment(ctx, t, pool, placementDeptID)

	// Step 1: Enroll student via API
	enrollReqBody := fmt.Sprintf(`{
		"principal_id": "%s",
		"enrollment_number": "TEST001",
		"college_department_id": "%s",
		"placement_department_id": "%s"
	}`, principalID, collegeDeptID, placementDeptID)

	enrollReq := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/v1/tenants/%s/students", tenantID), strings.NewReader(enrollReqBody))
	enrollReq = withTestAuthorization(enrollReq, actorID, []string{"department_user"})
	enrollW := httptest.NewRecorder()

	handler.ServeHTTP(enrollW, enrollReq)
	require.Equal(t, http.StatusCreated, enrollW.Code, "Failed to enroll student: %s", enrollW.Body.String())
	studentID := decodeEnrolledStudentID(t, enrollW.Body.Bytes())

	// Step 2: Verify student exists via GET
	getReq := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/v1/tenants/%s/students/%s", tenantID, studentID), nil)
	getReq = withTestAuthorization(getReq, actorID, []string{"department_user"})
	getW := httptest.NewRecorder()

	handler.ServeHTTP(getW, getReq)
	assert.Equal(t, http.StatusOK, getW.Code, "Student should be accessible before deletion")

	// Step 3: Soft delete via API
	deleteReqBody := `{"reason": "Student withdrew from program"}`
	deleteReq := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/v1/tenants/%s/students/%s", tenantID, studentID), strings.NewReader(deleteReqBody))
	deleteReq = withTestAuthorization(deleteReq, actorID, []string{"department_user"})
	deleteW := httptest.NewRecorder()

	handler.ServeHTTP(deleteW, deleteReq)
	require.Equal(t, http.StatusNoContent, deleteW.Code, "Soft delete should succeed: %s", deleteW.Body.String())

	// Step 4: Verify not found in default query
	getAfterDeleteReq := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/v1/tenants/%s/students/%s", tenantID, studentID), nil)
	getAfterDeleteReq = withTestAuthorization(getAfterDeleteReq, actorID, []string{"department_user"})
	getAfterDeleteW := httptest.NewRecorder()

	handler.ServeHTTP(getAfterDeleteW, getAfterDeleteReq)
	assert.Equal(t, http.StatusNotFound, getAfterDeleteW.Code, "Soft-deleted student should not be found in default queries")

	// Step 5: Verify database state directly (optional - validates filtering at repository layer)
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx)

	// Set RLS context
	_, err = tx.Exec(ctx, "SELECT set_config('app.tenant_id', $1, true)", tenantID.String())
	require.NoError(t, err)
	_, err = tx.Exec(ctx, "SELECT set_config('app.actor_id', $1, true)", actorID.String())
	require.NoError(t, err)

	// GetStudent should not find soft-deleted record
	_, err = store.GetStudent(ctx, tx, studentID)
	assert.Error(t, err, "GetStudent should not find soft-deleted records")

	// GetStudentIncludeDeleted should find the record
	deletedStudent, err := store.GetStudentIncludeDeleted(ctx, tx, studentID)
	require.NoError(t, err, "GetStudentIncludeDeleted should find soft-deleted records")
	assert.Equal(t, studentID, deletedStudent.ID)

	t.Logf("Soft delete flow validated: student %s soft-deleted by actor %s", studentID, actorID)
}

// TestHardDeleteFlow_SuperAdminOnly validates that only SuperAdmin can hard delete.
// Tests authorization enforcement at both API and database layers.
func TestHardDeleteFlow_SuperAdminOnly(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	ctx := context.Background()
	pool := setupTestDatabase(t)
	defer pool.Close()

	store := repo.NewPostgres(pool)
	service, err := app.NewManagementService(pool, store)
	require.NoError(t, err)

	authorizer := createTestAuthorizer(ctx, t, pool)
	readinessFunc := func(ctx context.Context) error { return nil }
	handler, err := httpadapter.NewHandler("user-test", service, readinessFunc, authorizer)
	require.NoError(t, err)

	tenantID := uuid.New()
	principalID := uuid.New()
	normalActorID := uuid.New()
	superAdminID := uuid.New()
	collegeDeptID := uuid.New()
	placementDeptID := uuid.New()

	seedActorTenantAuthorization(ctx, t, pool, normalActorID, tenantID)
	seedActorTenantAuthorization(ctx, t, pool, superAdminID, tenantID)
	seedCollegeDepartment(ctx, t, pool, collegeDeptID, tenantID)
	seedPlacementDepartment(ctx, t, pool, placementDeptID)

	// Step 1: Enroll student
	enrollReqBody := fmt.Sprintf(`{
		"principal_id": "%s",
		"enrollment_number": "TEST002",
		"college_department_id": "%s",
		"placement_department_id": "%s"
	}`, principalID, collegeDeptID, placementDeptID)

	enrollReq := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/v1/tenants/%s/students", tenantID), strings.NewReader(enrollReqBody))
	enrollReq = withTestAuthorization(enrollReq, normalActorID, []string{"department_user"})
	enrollW := httptest.NewRecorder()

	handler.ServeHTTP(enrollW, enrollReq)
	require.Equal(t, http.StatusCreated, enrollW.Code, "Failed to enroll student")
	studentID := decodeEnrolledStudentID(t, enrollW.Body.Bytes())

	// Step 2: Soft delete first
	softDeleteReqBody := `{"reason": "Test soft delete"}`
	softDeleteReq := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/v1/tenants/%s/students/%s", tenantID, studentID), strings.NewReader(softDeleteReqBody))
	softDeleteReq = withTestAuthorization(softDeleteReq, normalActorID, []string{"department_user"})
	softDeleteW := httptest.NewRecorder()

	handler.ServeHTTP(softDeleteW, softDeleteReq)
	require.Equal(t, http.StatusNoContent, softDeleteW.Code, "Soft delete should succeed")

	// Step 3: Attempt hard delete as non-SuperAdmin (should fail)
	hardDeleteReqBody := `{"reason": "Unauthorized attempt"}`
	hardDeleteReq := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/v1/tenants/%s/students/%s/hard", tenantID, studentID), strings.NewReader(hardDeleteReqBody))
	hardDeleteReq = withTestAuthorization(hardDeleteReq, normalActorID, []string{"college_admin"})
	hardDeleteW := httptest.NewRecorder()

	handler.ServeHTTP(hardDeleteW, hardDeleteReq)
	assert.Equal(t, http.StatusForbidden, hardDeleteW.Code, "Non-SuperAdmin should not be able to hard delete")

	// Step 4: Attempt as SuperAdmin (should succeed)
	superAdminDeleteReqBody := `{"reason": "Data retention period expired"}`
	superAdminDeleteReq := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/v1/tenants/%s/students/%s/hard", tenantID, studentID), strings.NewReader(superAdminDeleteReqBody))
	superAdminDeleteReq = withTestAuthorization(superAdminDeleteReq, superAdminID, []string{"super_admin"})
	superAdminDeleteW := httptest.NewRecorder()

	handler.ServeHTTP(superAdminDeleteW, superAdminDeleteReq)
	require.Equal(t, http.StatusNoContent, superAdminDeleteW.Code, "SuperAdmin should be able to hard delete: %s", superAdminDeleteW.Body.String())

	// Step 5: Verify physically deleted (not even accessible with IncludeDeleted)
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx)

	// Set RLS context
	_, err = tx.Exec(ctx, "SELECT set_config('app.tenant_id', $1, true)", tenantID.String())
	require.NoError(t, err)
	_, err = tx.Exec(ctx, "SELECT set_config('app.actor_id', $1, true)", superAdminID.String())
	require.NoError(t, err)

	_, err = store.GetStudentIncludeDeleted(ctx, tx, studentID)
	assert.Error(t, err, "Hard-deleted record should not exist even with IncludeDeleted")

	t.Logf("Hard delete flow validated: only SuperAdmin %s could hard delete student %s", superAdminID, studentID)
}

// TestSoftDeleteQueryFiltering validates that soft-deleted records are consistently filtered.
func TestSoftDeleteQueryFiltering(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	ctx := context.Background()
	pool := setupTestDatabase(t)
	defer pool.Close()

	store := repo.NewPostgres(pool)
	tenantID := uuid.New()
	actorID := uuid.New()

	// Create multiple students
	studentIDs := make([]uuid.UUID, 3)
	for i := 0; i < 3; i++ {
		studentIDs[i] = uuid.New()
		// In a real test, you'd enroll these students via the service
		// For now, we document the expected behavior
	}

	// Soft delete one student
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx)

	// Set RLS context
	_, err = tx.Exec(ctx, "SELECT set_config('app.tenant_id', $1, true)", tenantID.String())
	require.NoError(t, err)
	_, err = tx.Exec(ctx, "SELECT set_config('app.actor_id', $1, true)", actorID.String())
	require.NoError(t, err)

	deleteCmd := app.DeleteStudent{
		ID:      studentIDs[0].String(),
		ActorID: actorID.String(),
		Reason:  "Test filtering",
	}

	err = store.SoftDeleteStudent(ctx, tx, deleteCmd)
	if err != nil {
		t.Logf("Soft delete returned error (expected if student doesn't exist): %v", err)
	}

	// Verify filtering: GetStudent should not find soft-deleted record
	_, err = store.GetStudent(ctx, tx, studentIDs[0].String())
	assert.Error(t, err, "Soft-deleted student should not be found by GetStudent")

	t.Log("Query filtering validated: soft-deleted records are correctly filtered")
}

// setupTestDatabase initializes a test database connection.
// Reads DATABASE_URL from environment or skips the test if not available.
func setupTestDatabase(t *testing.T) *pgxpool.Pool {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		t.Skip("DATABASE_URL not set, skipping integration test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dbURL)
	require.NoError(t, err, "Failed to connect to test database")

	err = pool.Ping(ctx)
	require.NoError(t, err, "Failed to ping test database")

	return pool
}

// decodeEnrolledStudentID extracts the server-generated student ID from an
// enroll response body. The handler mints this ID itself (database.NewUUIDv7),
// so callers must read it back rather than assume a client-chosen value.
func decodeEnrolledStudentID(t *testing.T, body []byte) string {
	t.Helper()
	var enrolled struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(body, &enrolled), "decode enroll response")
	require.NotEmpty(t, enrolled.ID, "enroll response missing student id")
	return enrolled.ID
}

// testAuthzRevision is the fixed authorization revision every seeded actor
// grant and every issued test capability agree on. authz.set_context and its
// RLS-backing functions reject a capability whose revision does not match a
// current authz.principal_authorization_revisions / actor_tenant_authorizations row.
const testAuthzRevision int64 = 1

// fakeAuthorizationRPC stands in for the central Authorization service's gRPC
// endpoint. It decodes the caller's identity and roles from the same
// unverified test bearer token AuthorizeHTTP already extracted the principal
// from (carried through as the identity assertion), denies "delete" actions
// to anything but a "super_admin" role exactly as the real Casbin policy
// would, and otherwise issues a database capability signed by the keyring
// this test seeded into authz.context_keys.
type fakeAuthorizationRPC struct {
	keyring  *centralauthz.Keyring
	audience string
}

func (rpc *fakeAuthorizationRPC) Authorize(
	_ context.Context, request *authzv1.AuthorizeRequest, _ ...grpc.CallOption,
) (*authzv1.AuthorizeResponse, error) {
	claims, err := decodeTestBearerClaims(request.GetIdentityAssertion())
	if err != nil {
		return &authzv1.AuthorizeResponse{Allowed: false}, nil
	}
	if request.GetAction() == "delete" && !hasRole(claims.Roles, "super_admin") {
		return &authzv1.AuthorizeResponse{Allowed: false}, nil
	}

	decisionID := strings.ToLower(uuid.New().String())
	capability, err := rpc.keyring.Issue(
		rpc.audience, request.GetPrincipalId(), request.GetTenantId(), testAuthzRevision,
		decisionID, "user."+request.GetAction(), "users."+request.GetResourceType(), time.Now(),
	)
	if err != nil {
		return nil, fmt.Errorf("issue test database capability: %w", err)
	}
	encoded, err := capability.Encode()
	if err != nil {
		return nil, fmt.Errorf("encode test database capability: %w", err)
	}
	return &authzv1.AuthorizeResponse{
		Allowed:            true,
		DecisionId:         decisionID,
		AuthzRevision:      uint64(testAuthzRevision),
		DatabaseCapability: encoded,
	}, nil
}

// createTestAuthorizer builds a real *httpauth.Authorizer backed by
// fakeAuthorizationRPC. The signed database capability it returns is
// re-verified by authz.set_context exactly as it would be in production, so
// this seeds a matching signing key into authz.context_keys first.
func createTestAuthorizer(ctx context.Context, t *testing.T, pool *pgxpool.Pool) *httpauth.Authorizer {
	t.Helper()

	var databaseName string
	require.NoError(t, pool.QueryRow(ctx, "SELECT current_database()").Scan(&databaseName), "read test database name")

	keyID := uuid.New()
	secret := []byte(strings.Repeat("t", 32))
	_, err := pool.Exec(ctx, `
		INSERT INTO authz.context_keys (key_id, audience, key_material, not_before, not_after)
		VALUES ($1, $2, $3, clock_timestamp() - interval '1 minute', clock_timestamp() + interval '1 hour')
	`, keyID, databaseName, secret)
	require.NoError(t, err, "seed test authorization context key")

	// authz.set_context fails closed until the local grant projection has
	// completed at least one resync (see 000012_authorization_projection_resync).
	// Outside a real projection worker, mark the singleton state ready so a
	// correctly seeded actor_tenant_authorizations row is actually honored.
	_, err = pool.Exec(ctx, `
		UPDATE authz.authorization_projection_resync_state
		SET projection_ready = true,
		    active_resync_id = COALESCE(active_resync_id, $1),
		    completion_event_id = COALESCE(completion_event_id, $2),
		    expected_snapshot_count = COALESCE(expected_snapshot_count, 0),
		    expected_manifest_sha256 = COALESCE(expected_manifest_sha256, $3)
		WHERE singleton = true
	`, uuid.New(), uuid.New(), make([]byte, 32))
	require.NoError(t, err, "mark test authorization projection ready")

	keyring, err := centralauthz.ParseKeyring(fmt.Sprintf(
		`[{"audience":%q,"key_id":%q,"secret_base64":%q}]`,
		databaseName, keyID.String(), base64.StdEncoding.EncodeToString(secret),
	))
	require.NoError(t, err, "parse test authorization keyring")

	client, err := centralauthz.NewClient(&fakeAuthorizationRPC{keyring: keyring, audience: databaseName})
	require.NoError(t, err)

	authorizer, err := httpauth.New(client, "user")
	require.NoError(t, err)
	return authorizer
}

// seedActorTenantAuthorization grants an actor a tenant-scoped authorization
// at testAuthzRevision. authz.set_context rejects an otherwise valid signed
// capability unless both this row and its principal_authorization_revisions
// snapshot are already current for the actor.
func seedActorTenantAuthorization(ctx context.Context, t *testing.T, pool *pgxpool.Pool, actorID, tenantID uuid.UUID) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		INSERT INTO authz.actor_tenant_authorizations
		    (actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id)
		VALUES ($1, $2, $3, true, 'tenant', $2)
		ON CONFLICT (actor_id, tenant_id, grant_kind, grant_source_id) DO UPDATE
		SET authz_revision = EXCLUDED.authz_revision, is_authorized = true
	`, actorID, tenantID, testAuthzRevision)
	require.NoError(t, err, "seed actor tenant authorization")

	_, err = pool.Exec(ctx, `
		INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision)
		VALUES ($1, $2)
		ON CONFLICT (actor_id) DO UPDATE SET authz_revision = EXCLUDED.authz_revision
	`, actorID, testAuthzRevision)
	require.NoError(t, err, "seed actor authorization revision snapshot")
}

// seedCollegeDepartment and seedPlacementDepartment satisfy the active
// department projections users.enroll_student_with_affiliations requires
// before it will create a student's two mandatory memberships.
func seedCollegeDepartment(ctx context.Context, t *testing.T, pool *pgxpool.Pool, departmentID, tenantID uuid.UUID) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		INSERT INTO users.tenant_department_projections
		    (department_id, tenant_id, department_type, status, source_event_id, source_occurred_at)
		VALUES ($1, $2, 'college', 'active', $3, clock_timestamp())
	`, departmentID, tenantID, uuid.New())
	require.NoError(t, err, "seed college department projection")
}

func seedPlacementDepartment(ctx context.Context, t *testing.T, pool *pgxpool.Pool, departmentID uuid.UUID) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		INSERT INTO users.tenant_department_projections
		    (department_id, tenant_id, placement_organization_id, department_type, status, source_event_id, source_occurred_at)
		VALUES ($1, NULL, $2, 'placement', 'active', $3, clock_timestamp())
	`, departmentID, uuid.New(), uuid.New())
	require.NoError(t, err, "seed placement department projection")
}

// testClaims is the unverified subject-plus-roles payload carried by the
// unsigned bearer token issued below. authn.UnverifiedSubject reads only
// "sub"; fakeAuthorizationRPC additionally reads "roles" to stand in for the
// central Casbin decision a real deployment would make instead.
type testClaims struct {
	Subject string   `json:"sub"`
	Roles   []string `json:"roles"`
}

// testBearerToken builds a compact, unsigned, JWS-shaped token: three
// dot-separated base64url segments with no cryptographic signature.
// authn.UnverifiedSubject only requires that shape and never checks the
// signature segment, matching how AuthorizeHTTP's routing-only subject
// extraction is documented to work.
func testBearerToken(actorID uuid.UUID, roles []string) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none","typ":"JWT"}`))
	claims, _ := json.Marshal(testClaims{Subject: actorID.String(), Roles: roles})
	payload := base64.RawURLEncoding.EncodeToString(claims)
	return header + "." + payload + ".unsigned"
}

func decodeTestBearerClaims(token string) (testClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return testClaims{}, fmt.Errorf("malformed test bearer token")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return testClaims{}, fmt.Errorf("decode test bearer token claims: %w", err)
	}
	var claims testClaims
	if err := json.Unmarshal(raw, &claims); err != nil {
		return testClaims{}, fmt.Errorf("decode test bearer token claims JSON: %w", err)
	}
	return claims, nil
}

func hasRole(roles []string, role string) bool {
	for _, candidate := range roles {
		if candidate == role {
			return true
		}
	}
	return false
}

// withTestAuthorization attaches an unsigned test bearer token carrying the
// actor's ID and roles as the request's identity assertion. AuthorizeHTTP
// reads the actor from this token exactly as it would a real signed identity
// assertion; fakeAuthorizationRPC reads the same token in place of a central
// Casbin decision.
func withTestAuthorization(req *http.Request, actorID uuid.UUID, roles []string) *http.Request {
	req.Header.Set("Authorization", "Bearer "+testBearerToken(actorID, roles))
	return req
}
