package app

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
)

const (
	testPrincipal = "018f4b0d-08f8-7c09-9ba7-efdf9c223355"
	testTenant    = "018f4b0d-08f8-7c09-9ba7-efdf9c223366"
	testRequestID = "018f4b0d-08f8-7c09-9ba7-efdf9c223377"
	testKeyID     = "018f4b0d-08f8-7c09-9ba7-efdf9c223388"
	testPlacement = "018f4b0d-08f8-7c09-9ba7-efdf9c223399"
)

type fakeStore struct {
	snapshot Snapshot
	err      error
}

func (store fakeStore) Snapshot(context.Context, SnapshotQuery) (Snapshot, error) {
	return store.snapshot, store.err
}

func (store fakeStore) Ping(context.Context) error { return store.err }

func TestAuthorizeIssuesAudienceBoundCapabilityForCurrentPolicy(t *testing.T) {
	t.Parallel()
	keyring := testKeyring(t)
	service, err := NewService(fakeStore{snapshot: Snapshot{
		Revision: 7,
		Assignments: []Assignment{{
			Role: centralauthz.RoleCollegeAdmin, ScopeKind: "college", TenantID: testTenant, ScopeID: testTenant,
		}},
		PolicyRules: []centralauthz.PolicyRule{{PType: "p", Values: []string{"college_admin", "college", "/attempts/:id", "read"}}},
	}}, keyring, nil, false)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	now := time.Date(2026, time.July, 24, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }

	decision, err := service.Authorize(context.Background(), Request{
		PrincipalID: testPrincipal, TenantID: testTenant, RequestID: testRequestID,
		Action: "read", ResourceType: "attempts", ResourceID: "attempt-123", TargetService: "submission",
	})
	if err != nil {
		t.Fatalf("Authorize() error = %v", err)
	}
	if !decision.Allowed || decision.AuthzRevision != 7 || decision.Capability == "" {
		t.Fatalf("Authorize() = %#v, want allowed decision with capability", decision)
	}
	capability, err := centralauthz.DecodeCapability(decision.Capability, now.Add(time.Second))
	if err != nil {
		t.Fatalf("DecodeCapability() error = %v", err)
	}
	if capability.Audience != "aether_submission" || capability.Action != "submission.read" || capability.Resource != "submission.attempts" {
		t.Fatalf("capability = %#v, want submission audience/read/attempts", capability)
	}
}

func TestAuthorizeDeniesWithoutCanonicalPolicyAndFailsClosedOnStoreFailure(t *testing.T) {
	t.Parallel()
	keyring := testKeyring(t)
	service, err := NewService(fakeStore{snapshot: Snapshot{
		Revision:    1,
		Assignments: []Assignment{{Role: centralauthz.RoleCollegeAdmin, ScopeKind: "college", TenantID: testTenant, ScopeID: testTenant}},
	}}, keyring, nil, false)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	request := Request{PrincipalID: testPrincipal, TenantID: testTenant, RequestID: testRequestID, Action: "write", ResourceType: "attempts", ResourceID: "attempt-123", TargetService: "submission"}
	decision, err := service.Authorize(context.Background(), request)
	if err != nil {
		t.Fatalf("Authorize() error = %v", err)
	}
	if decision.Allowed || decision.Capability != "" {
		t.Fatalf("Authorize() = %#v, want deny without a canonical policy", decision)
	}

	failingService, err := NewService(fakeStore{err: errors.New("database unavailable")}, keyring, nil, false)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	if _, err := failingService.Authorize(context.Background(), request); err == nil {
		t.Fatal("Authorize() accepted a store failure")
	}
}

type fakeIdentityAssertionVerifier struct {
	identity VerifiedIdentity
	err      error
}

func (verifier fakeIdentityAssertionVerifier) Verify(context.Context, string) (VerifiedIdentity, error) {
	return verifier.identity, verifier.err
}

func TestAuthorizeRequiresIdentityAssertionBoundToPrincipal(t *testing.T) {
	t.Parallel()
	keyring := testKeyring(t)
	verifier := fakeIdentityAssertionVerifier{identity: VerifiedIdentity{PrincipalID: testPrincipal}}
	service, err := NewService(fakeStore{}, keyring, verifier, true)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	request := Request{
		PrincipalID: testPrincipal, TenantID: testTenant, RequestID: testRequestID,
		Action: "read", ResourceType: "attempts", ResourceID: "attempt-123", TargetService: "submission",
	}

	if _, err := service.Authorize(context.Background(), request); !isAuthenticationError(err) {
		t.Fatalf("Authorize() error = %v, want authentication error for missing assertion", err)
	}

	request.IdentityAssertion = "signed-identity-assertion"
	if _, err := service.Authorize(context.Background(), request); err != nil {
		t.Fatalf("Authorize() error = %v, want assertion accepted before policy denial", err)
	}

	service.identityAssertionVerifier = fakeIdentityAssertionVerifier{identity: VerifiedIdentity{
		PrincipalID: "018f4b0d-08f8-7c09-9ba7-efdf9c223399",
	}}
	if _, err := service.Authorize(context.Background(), request); !isAuthenticationError(err) {
		t.Fatalf("Authorize() error = %v, want authentication error for principal mismatch", err)
	}
}

func TestNewServiceRequiresVerifierWhenIdentityAssertionsAreEnforced(t *testing.T) {
	t.Parallel()
	if _, err := NewService(fakeStore{}, testKeyring(t), nil, true); err == nil {
		t.Fatal("NewService() accepted enforced identity assertions without a verifier")
	}
}

func TestPlacementAssignmentRequiresCurrentStaffAndTargetMembership(t *testing.T) {
	t.Parallel()
	assignment := Assignment{
		Role: centralauthz.RolePlacementUser, ScopeKind: "placement_department",
		TenantID: testTenant, ScopeID: testPlacement,
	}
	request := Request{
		PrincipalID: testPrincipal, TenantID: testTenant, Action: "read",
		ResourceType: "students", ResourceID: "018f4b0d-08f8-7c09-9ba7-efdf9c223400",
	}
	targetScopes := map[string]struct{}{testPlacement: {}}
	if assignmentApplies(assignment, request, targetScopes, nil, nil) {
		t.Fatal("placement assignment applied after the caller's staff membership was removed")
	}
	if !assignmentApplies(assignment, request, targetScopes, map[string]struct{}{testPlacement: {}}, nil) {
		t.Fatal("placement assignment did not apply with both target and staff membership")
	}
	if assignmentApplies(assignment, request, nil, map[string]struct{}{testPlacement: {}}, nil) {
		t.Fatal("placement assignment applied to a student outside the placement department")
	}
}

func TestStudentBatchAffiliationIsAProtectedPlacementScopedUserResource(t *testing.T) {
	t.Parallel()
	request, routeValue, err := validateRequest(Request{
		PrincipalID: testPrincipal, TenantID: testTenant, RequestID: testRequestID,
		Action: "write", ResourceType: "student_batch_affiliations",
		ResourceID: "018f4b0d-08f8-7c09-9ba7-efdf9c223400", TargetService: "user",
	})
	if err != nil {
		t.Fatalf("validateRequest() error = %v", err)
	}
	if routeValue.Audience != "aether_users" || routeValue.ResourcePrefix != "users" {
		t.Fatalf("route = %#v, want User capability route", routeValue)
	}
	assignment := Assignment{
		Role: centralauthz.RolePlacementUser, ScopeKind: "placement_department",
		TenantID: testTenant, ScopeID: testPlacement,
	}
	placementScopes := map[string]struct{}{testPlacement: {}}
	if !assignmentApplies(assignment, request, placementScopes, placementScopes, nil) {
		t.Fatal("placement assignment did not apply to a student batch affiliation in its placement scope")
	}
}

func TestAuthorizeAllowsPlacementStaffToWriteStudentBatchAffiliations(t *testing.T) {
	t.Parallel()
	keyring, err := centralauthz.ParseKeyring(`[{
		"audience":"aether_users",
		"key_id":"` + testKeyID + `",
		"secret_base64":"` + base64.StdEncoding.EncodeToString([]byte(strings.Repeat("u", 32))) + `"
	}]`)
	if err != nil {
		t.Fatalf("ParseKeyring() error = %v", err)
	}
	service, err := NewService(fakeStore{snapshot: Snapshot{
		Revision: 9,
		Assignments: []Assignment{{
			Role: centralauthz.RolePlacementUser, ScopeKind: "placement_department",
			TenantID: testTenant, ScopeID: testPlacement,
		}},
		TargetStudentPlacementScopes: map[string]struct{}{testPlacement: {}},
		PlacementStaffScopes:         map[string]struct{}{testPlacement: {}},
		PolicyRules: []centralauthz.PolicyRule{{
			PType: "p", Values: []string{"placement_user", "placement_department", "/student_batch_affiliations/:id", "write"},
		}},
	}}, keyring, nil, false)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	decision, err := service.Authorize(context.Background(), Request{
		PrincipalID: testPrincipal, TenantID: testTenant, RequestID: testRequestID,
		Action: "write", ResourceType: "student_batch_affiliations",
		ResourceID: "018f4b0d-08f8-7c09-9ba7-efdf9c223403", TargetService: "user",
	})
	if err != nil {
		t.Fatalf("Authorize() error = %v", err)
	}
	if !decision.Allowed || decision.Capability == "" {
		t.Fatalf("Authorize() = %#v, want placement-scoped allow", decision)
	}
}

func TestStudentSelfScopeRequiresCandidateAssignmentOwnership(t *testing.T) {
	t.Parallel()
	assignment := Assignment{
		Role: centralauthz.RoleStudent, ScopeKind: "self", TenantID: testTenant, ScopeID: testPrincipal,
	}
	request := Request{
		PrincipalID: testPrincipal, TenantID: testTenant, Action: "read",
		ResourceType: "candidate_assignments", ResourceID: "018f4b0d-08f8-7c09-9ba7-efdf9c223401",
	}
	if assignmentApplies(assignment, request, nil, nil, nil) {
		t.Fatal("student self scope accepted an arbitrary candidate assignment")
	}
	if !assignmentApplies(assignment, request, nil, nil, map[string]struct{}{request.ResourceID: {}}) {
		t.Fatal("student self scope rejected its projected candidate assignment")
	}
}

func TestStudentSelfScopeBindsNotificationResourcesToTheBearer(t *testing.T) {
	t.Parallel()
	assignment := Assignment{
		Role: centralauthz.RoleStudent, ScopeKind: "self", TenantID: testTenant, ScopeID: testPrincipal,
	}
	for _, resourceType := range []string{"recipient_preferences", "notifications"} {
		request := Request{
			PrincipalID: testPrincipal, TenantID: testTenant, Action: "read",
			ResourceType: resourceType, ResourceID: testPrincipal,
		}
		if !assignmentApplies(assignment, request, nil, nil, nil) {
			t.Fatalf("student self scope rejected own %s", resourceType)
		}
		request.ResourceID = "018f4b0d-08f8-7c09-9ba7-efdf9c223402"
		if assignmentApplies(assignment, request, nil, nil, nil) {
			t.Fatalf("student self scope accepted another recipient's %s", resourceType)
		}
	}
}

func TestStudentSelfScopeBindsSEBValidationToTheBearer(t *testing.T) {
	t.Parallel()
	assignment := Assignment{
		Role: centralauthz.RoleStudent, ScopeKind: "self", TenantID: testTenant, ScopeID: testPrincipal,
	}
	request := Request{
		PrincipalID: testPrincipal, TenantID: testTenant, Action: "write",
		ResourceType: "validation_events", ResourceID: testPrincipal,
	}
	if !assignmentApplies(assignment, request, nil, nil, nil) {
		t.Fatal("student self scope rejected its own SEB validation resource")
	}
	request.ResourceID = "018f4b0d-08f8-7c09-9ba7-efdf9c223405"
	if assignmentApplies(assignment, request, nil, nil, nil) {
		t.Fatal("student self scope accepted another SEB validation resource")
	}
}

func isAuthenticationError(err error) bool {
	var authenticationError AuthenticationError
	return errors.As(err, &authenticationError)
}

func testKeyring(t *testing.T) *centralauthz.Keyring {
	t.Helper()
	keyring, err := centralauthz.ParseKeyring(`[{"audience":"aether_submission","key_id":"` + testKeyID + `","secret_base64":"` + base64.StdEncoding.EncodeToString([]byte(strings.Repeat("d", 32))) + `"}]`)
	if err != nil {
		t.Fatalf("ParseKeyring() error = %v", err)
	}
	return keyring
}
