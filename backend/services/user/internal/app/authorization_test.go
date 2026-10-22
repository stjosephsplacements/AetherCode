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
	audit    *[]StaffAction
}

func (store fakeStore) RecordStaffAction(_ context.Context, action StaffAction) error {
	if store.audit != nil {
		*store.audit = append(*store.audit, action)
	}
	return nil
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
	if assignmentApplies(assignment, request, false, targetScopes, nil, nil) {
		t.Fatal("placement assignment applied after the caller's staff membership was removed")
	}
	if !assignmentApplies(assignment, request, false, targetScopes, map[string]struct{}{testPlacement: {}}, nil) {
		t.Fatal("placement assignment did not apply with both target and staff membership")
	}
	if assignmentApplies(assignment, request, false, nil, map[string]struct{}{testPlacement: {}}, nil) {
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
	if !assignmentApplies(assignment, request, false, placementScopes, placementScopes, nil) {
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
	if assignmentApplies(assignment, request, false, nil, nil, nil) {
		t.Fatal("student self scope accepted an arbitrary candidate assignment")
	}
	if !assignmentApplies(assignment, request, false, nil, nil, map[string]struct{}{request.ResourceID: {}}) {
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
		if !assignmentApplies(assignment, request, false, nil, nil, nil) {
			t.Fatalf("student self scope rejected own %s", resourceType)
		}
		request.ResourceID = "018f4b0d-08f8-7c09-9ba7-efdf9c223402"
		if assignmentApplies(assignment, request, false, nil, nil, nil) {
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
	if !assignmentApplies(assignment, request, false, nil, nil, nil) {
		t.Fatal("student self scope rejected its own SEB validation resource")
	}
	request.ResourceID = "018f4b0d-08f8-7c09-9ba7-efdf9c223405"
	if assignmentApplies(assignment, request, false, nil, nil, nil) {
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

func TestAssignmentAppliesAllowsCandidateAssignmentCollection(t *testing.T) {
	t.Parallel()
	principal := "018f4b0d-08f8-7c09-9ba7-efdf9c220101"
	tenant := "018f4b0d-08f8-7c09-9ba7-efdf9c220202"
	assignment := Assignment{Role: "student", ScopeKind: "self", ScopeID: principal, TenantID: tenant}
	request := Request{
		PrincipalID: principal, TenantID: tenant,
		ResourceType: "candidate_assignments", ResourceID: principal, Action: "read",
	}
	if !assignmentApplies(assignment, request, false, nil, nil, nil) {
		t.Fatal("assignmentApplies() = false, want true for a candidate listing their own assignments")
	}
}

func TestAssignmentAppliesDeniesForeignCandidateAssignmentCollection(t *testing.T) {
	t.Parallel()
	principal := "018f4b0d-08f8-7c09-9ba7-efdf9c220101"
	other := "018f4b0d-08f8-7c09-9ba7-efdf9c220999"
	tenant := "018f4b0d-08f8-7c09-9ba7-efdf9c220202"
	assignment := Assignment{Role: "student", ScopeKind: "self", ScopeID: principal, TenantID: tenant}
	request := Request{
		PrincipalID: principal, TenantID: tenant,
		ResourceType: "candidate_assignments", ResourceID: other, Action: "read",
	}
	if assignmentApplies(assignment, request, false, nil, nil, nil) {
		t.Fatal("assignmentApplies() = true, want false when the resource ID is another principal")
	}
}

func TestAssignmentAppliesAllowsOwnSessionCollection(t *testing.T) {
	t.Parallel()
	principal := "018f4b0d-08f8-7c09-9ba7-efdf9c220101"
	tenant := "018f4b0d-08f8-7c09-9ba7-efdf9c220202"
	assignment := Assignment{Role: "student", ScopeKind: "self", ScopeID: principal, TenantID: tenant}
	request := Request{
		PrincipalID: principal, TenantID: tenant,
		ResourceType: "sessions", ResourceID: principal, Action: "read",
	}
	if !assignmentApplies(assignment, request, false, nil, nil, nil) {
		t.Fatal("assignmentApplies() = false, want true for a candidate listing their own SEB sessions")
	}
}

func TestAssignmentAppliesDeniesForeignSessionCollection(t *testing.T) {
	t.Parallel()
	principal := "018f4b0d-08f8-7c09-9ba7-efdf9c220101"
	other := "018f4b0d-08f8-7c09-9ba7-efdf9c220999"
	tenant := "018f4b0d-08f8-7c09-9ba7-efdf9c220202"
	assignment := Assignment{Role: "student", ScopeKind: "self", ScopeID: principal, TenantID: tenant}
	request := Request{
		PrincipalID: principal, TenantID: tenant,
		ResourceType: "sessions", ResourceID: other, Action: "read",
	}
	if assignmentApplies(assignment, request, false, nil, nil, nil) {
		t.Fatal("assignmentApplies() = true, want false when the resource ID is another principal")
	}
}

func TestAssignmentAppliesDeniesSelfScopeInAnotherTenant(t *testing.T) {
	t.Parallel()
	principal := "018f4b0d-08f8-7c09-9ba7-efdf9c220101"
	assignment := Assignment{
		Role: "student", ScopeKind: "self", ScopeID: principal,
		TenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c220202",
	}
	request := Request{
		PrincipalID: principal, TenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c220303",
		ResourceType: "sessions", ResourceID: principal, Action: "read",
	}
	if assignmentApplies(assignment, request, false, nil, nil, nil) {
		t.Fatal("assignmentApplies() = true, want false when the self scope belongs to another tenant")
	}
}

// ADR-0020: the global question bank accepts college_admin and
// department_user assignments from any college, and nothing else that is
// tenant-scoped. Routes without StaffAuthoring keep requiring a tenant.
func TestStaffAuthoringAppliesOnlyToStaffRolesOnTheQuestionBank(t *testing.T) {
	t.Parallel()
	request := Request{PrincipalID: testPrincipal, Action: "write", ResourceType: "questions", ResourceID: testPrincipal}
	for _, scenario := range []struct {
		assignment Assignment
		want       bool
	}{
		{Assignment{Role: centralauthz.RoleCollegeAdmin, ScopeKind: "college", TenantID: testTenant, ScopeID: testTenant}, true},
		{Assignment{Role: centralauthz.RoleDepartmentUser, ScopeKind: "department", TenantID: testTenant, ScopeID: testPrincipal}, true},
		{Assignment{Role: centralauthz.RoleMentor, ScopeKind: "batch", TenantID: testTenant, ScopeID: testPrincipal}, false},
		{Assignment{Role: centralauthz.RoleStudent, ScopeKind: "self", TenantID: testTenant, ScopeID: testPrincipal}, false},
	} {
		if got := assignmentApplies(scenario.assignment, request, true, nil, nil, nil); got != scenario.want {
			t.Fatalf("%s on the question bank = %v, want %v", scenario.assignment.Role, got, scenario.want)
		}
		if assignmentApplies(scenario.assignment, request, false, nil, nil, nil) {
			t.Fatalf("%s applied to a tenant-less request on a route without staff authoring", scenario.assignment.Role)
		}
	}
	if !routes["question-bank"].StaffAuthoring || routes["tenant"].StaffAuthoring {
		t.Fatal("only the question-bank route may enable staff authoring")
	}
}

// ADR-0032: exporting a question reveals its hidden tests, so of the staff
// roles only college administrators may; platform administrators still can.
func TestOnlyCollegeAdministratorsExportQuestions(t *testing.T) {
	t.Parallel()
	request := Request{PrincipalID: testPrincipal, Action: "write", ResourceType: "question_exports", ResourceID: testPrincipal}
	for _, scenario := range []struct {
		assignment Assignment
		want       bool
	}{
		{Assignment{Role: centralauthz.RoleCollegeAdmin, ScopeKind: "college", TenantID: testTenant, ScopeID: testTenant}, true},
		{Assignment{Role: centralauthz.RoleSuperAdmin, ScopeKind: "platform"}, true},
		{Assignment{Role: centralauthz.RoleDepartmentUser, ScopeKind: "department", TenantID: testTenant, ScopeID: testPrincipal}, false},
		{Assignment{Role: centralauthz.RoleMentor, ScopeKind: "batch", TenantID: testTenant, ScopeID: testPrincipal}, false},
	} {
		if got := assignmentApplies(scenario.assignment, request, true, nil, nil, nil); got != scenario.want {
			t.Errorf("%s exporting a question = %v, want %v", scenario.assignment.Role, got, scenario.want)
		}
	}
}

// ADR-0041: a student practises with a tenant-scoped capability for the bearer
// subject only; the question bank's other resources stay tenant-less.
func TestStudentsPractiseOnlyAsThemselvesWithTheirTenant(t *testing.T) {
	t.Parallel()
	keyring, err := centralauthz.ParseKeyring(`[{"audience":"aether_qbank","key_id":"` + testKeyID + `","secret_base64":"` + base64.StdEncoding.EncodeToString([]byte(strings.Repeat("q", 32))) + `"}]`)
	if err != nil {
		t.Fatalf("ParseKeyring() error = %v", err)
	}
	student := Assignment{Role: centralauthz.RoleStudent, ScopeKind: "self", TenantID: testTenant, ScopeID: testPrincipal}
	service, err := NewService(fakeStore{snapshot: Snapshot{
		Revision:    3,
		Assignments: []Assignment{student},
		PolicyRules: []centralauthz.PolicyRule{{PType: "p", Values: []string{"student", "self", "/practice_submissions/:id", "write"}}},
	}}, keyring, nil, false)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	now := time.Date(2026, time.October, 20, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	request := Request{PrincipalID: testPrincipal, TenantID: testTenant, RequestID: testRequestID,
		Action: "write", ResourceType: "practice_submissions", ResourceID: testPrincipal, TargetService: "question-bank"}

	decision, err := service.Authorize(context.Background(), request)
	if err != nil || !decision.Allowed {
		t.Fatalf("Authorize(own practice) = %#v, %v; want allowed", decision, err)
	}
	capability, err := centralauthz.DecodeCapability(decision.Capability, now.Add(time.Second))
	if err != nil {
		t.Fatalf("DecodeCapability() error = %v", err)
	}
	if capability.Audience != "aether_qbank" || capability.TenantID != testTenant || capability.Resource != "qbank.practice_submissions" {
		t.Fatalf("capability = %#v, want a tenant-scoped qbank practice capability", capability)
	}

	other := request
	other.ResourceID = "018f4b0d-08f8-7c09-9ba7-efdf9c229999"
	if decision, err := service.Authorize(context.Background(), other); err != nil || decision.Allowed {
		t.Fatalf("Authorize(another student's practice) = %#v, %v; want denied", decision, err)
	}
	tenantless := request
	tenantless.TenantID = ""
	if _, err := service.Authorize(context.Background(), tenantless); err == nil {
		t.Fatal("Authorize(practice without a tenant) succeeded, want a validation error")
	}
	questions := request
	questions.ResourceType = "questions"
	if _, err := service.Authorize(context.Background(), questions); err == nil {
		t.Fatal("Authorize(questions with a tenant) succeeded, want a validation error")
	}
}

// ADR-0043: staff write decisions, allowed or denied, become the audit log;
// reads and students' own writes do not, and only college administrators
// read the log, however broad a department's policy is.
func TestStaffWritesAreAudited(t *testing.T) {
	t.Parallel()
	keyring := testKeyring(t)
	var recorded []StaffAction
	newService := func(assignment Assignment, rules ...[]string) *Service {
		policy := make([]centralauthz.PolicyRule, 0, len(rules))
		for _, values := range rules {
			policy = append(policy, centralauthz.PolicyRule{PType: "p", Values: values})
		}
		service, err := NewService(fakeStore{snapshot: Snapshot{Revision: 2, Assignments: []Assignment{assignment}, PolicyRules: policy}, audit: &recorded}, keyring, nil, false)
		if err != nil {
			t.Fatal(err)
		}
		return service
	}
	request := Request{PrincipalID: testPrincipal, TenantID: testTenant, RequestID: testRequestID, Action: "write",
		ResourceType: "attempt_events", ResourceID: "exam-version-1", TargetService: "submission"}

	faculty := newService(Assignment{Role: centralauthz.RoleDepartmentUser, ScopeKind: "department", TenantID: testTenant, ScopeID: testPrincipal},
		[]string{"department_user", "department", "/*", "*"})
	if decision, err := faculty.Authorize(context.Background(), request); err != nil || !decision.Allowed {
		t.Fatalf("faculty write = %#v, %v", decision, err)
	}
	read := request
	read.Action = "read"
	if _, err := faculty.Authorize(context.Background(), read); err != nil {
		t.Fatal(err)
	}
	student := newService(Assignment{Role: centralauthz.RoleStudent, ScopeKind: "self", TenantID: testTenant, ScopeID: testPrincipal},
		[]string{"student", "self", "/attempts/:id", "write"})
	own := request
	own.ResourceType, own.ResourceID = "attempts", testPrincipal
	if _, err := student.Authorize(context.Background(), own); err != nil {
		t.Fatal(err)
	}
	if len(recorded) != 1 || recorded[0].ResourceType != "attempt_events" || !recorded[0].Allowed || recorded[0].TenantID != testTenant {
		t.Fatalf("audit = %#v, want only the faculty write", recorded)
	}

	audit := Request{PrincipalID: testPrincipal, TenantID: testTenant, RequestID: testRequestID, Action: "read",
		ResourceType: "staff_audit", ResourceID: testTenant, TargetService: "user"}
	if decision, err := faculty.Authorize(context.Background(), audit); err != nil || decision.Allowed {
		t.Fatalf("faculty reading the audit log = %#v, %v; want denied", decision, err)
	}
}

func TestStudentsUseCommunityContentButNeverModeration(t *testing.T) {
	t.Parallel()
	keyring, err := centralauthz.ParseKeyring(`[{"audience":"aether_notification","key_id":"` + testKeyID + `","secret_base64":"` + base64.StdEncoding.EncodeToString([]byte(strings.Repeat("n", 32))) + `"}]`)
	if err != nil {
		t.Fatalf("ParseKeyring() error = %v", err)
	}
	student := Assignment{Role: centralauthz.RoleStudent, ScopeKind: "self", TenantID: testTenant, ScopeID: testPrincipal}
	service, err := NewService(fakeStore{snapshot: Snapshot{
		Revision:    3,
		Assignments: []Assignment{student},
		PolicyRules: []centralauthz.PolicyRule{
			{PType: "p", Values: []string{"student", "self", "/community/:id", "read"}},
			{PType: "p", Values: []string{"student", "self", "/community/:id", "write"}},
		},
	}}, keyring, nil, false)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	service.now = func() time.Time { return time.Date(2026, time.October, 21, 12, 0, 0, 0, time.UTC) }
	request := Request{PrincipalID: testPrincipal, TenantID: testTenant, RequestID: testRequestID,
		Action: "write", ResourceType: "community", ResourceID: testPrincipal, TargetService: "notification"}

	if decision, err := service.Authorize(context.Background(), request); err != nil || !decision.Allowed {
		t.Fatalf("Authorize(own community write) = %#v, %v; want allowed", decision, err)
	}
	other := request
	other.ResourceID = "018f4b0d-08f8-7c09-9ba7-efdf9c229999"
	if decision, err := service.Authorize(context.Background(), other); err != nil || decision.Allowed {
		t.Fatalf("Authorize(community as another person) = %#v, %v; want denied", decision, err)
	}
	moderation := request
	moderation.ResourceType = "community_moderation"
	moderation.ResourceID = testTenant
	if decision, err := service.Authorize(context.Background(), moderation); err != nil || decision.Allowed {
		t.Fatalf("Authorize(student moderation) = %#v, %v; want denied", decision, err)
	}
	moderation.ResourceID = testPrincipal
	if decision, err := service.Authorize(context.Background(), moderation); err != nil || decision.Allowed {
		t.Fatalf("Authorize(student moderation as self) = %#v, %v; want denied", decision, err)
	}
}
