// Package app contains the canonical, fail-closed authorization use case.
package app

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
)

var (
	uuidPattern         = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	resourceTypePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,127}$`)
	resourceIDPattern   = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,255}$`)
)

// Request is the authenticated caller context supplied by a service over
// mTLS. Identity validation occurs before this call; this service makes the
// fresh authorization decision and never treats a cached allow as current.
type Request struct {
	PrincipalID       string
	Action            string
	ResourceType      string
	ResourceID        string
	TenantID          string
	RequestID         string
	TargetService     string
	IdentityAssertion string
}

// VerifiedIdentity is the minimum identity binding Authz needs from the
// identity-validation path. The verifier owns cryptographic token validation;
// Authz compares the verified principal with the request before policy lookup.
type VerifiedIdentity struct {
	PrincipalID string
}

// IdentityAssertionVerifier verifies a short-lived identity assertion minted
// by the trusted identity-validation flow. Implementations must validate its
// signature, expiry, audience, and principal binding.
type IdentityAssertionVerifier interface {
	Verify(context.Context, string) (VerifiedIdentity, error)
}

// Scope is an applicable, typed authorization scope returned to the caller.
type Scope struct {
	Kind string
	ID   string
}

// Assignment is the typed role binding loaded from the User database.
type Assignment struct {
	Role      centralauthz.Role
	ScopeKind string
	TenantID  string
	ScopeID   string
}

// Snapshot is one current, non-cached view of the canonical policy state.
type Snapshot struct {
	Revision                     int64
	Assignments                  []Assignment
	PolicyRules                  []centralauthz.PolicyRule
	TargetStudentPlacementScopes map[string]struct{}
	PlacementStaffScopes         map[string]struct{}
	OwnedCandidateAssignments    map[string]struct{}
}

// Store supplies one authorization snapshot. Its adapter authenticates as the
// dedicated aether_user_authz_reader role, never as a table owner.
type Store interface {
	Snapshot(context.Context, SnapshotQuery) (Snapshot, error)
	Ping(context.Context) error
}

// SnapshotQuery narrows relationship checks needed for placement scopes.
type SnapshotQuery struct {
	PrincipalID  string
	TenantID     string
	ResourceType string
	ResourceID   string
}

// Decision is returned to the gRPC adapter. Capabilities are issued only for
// allowed decisions and are audience-bound to one target service database.
type Decision struct {
	Allowed       bool
	DecisionID    string
	AuthzRevision int64
	Scopes        []Scope
	Capability    string
	ExpiresAt     time.Time
}

// ValidationError is safe to return to an internal caller as InvalidArgument.
type ValidationError struct {
	Field  string
	Reason string
}

func (errorValue *ValidationError) Error() string {
	return fmt.Sprintf("%s %s", errorValue.Field, errorValue.Reason)
}

// AuthenticationError is intentionally generic at the gRPC boundary so an
// untrusted caller cannot distinguish malformed, expired, or mismatched
// identity assertions.
type AuthenticationError struct{}

func (AuthenticationError) Error() string {
	return "identity assertion is invalid"
}

type route struct {
	Audience                string
	ActionPrefix            string
	ResourcePrefix          string
	Global                  bool
	GlobalResources         map[string]struct{}
	OptionalTenantResources map[string]struct{}
	Resources               map[string]struct{}
}

var routes = map[string]route{
	"tenant": {
		Audience: "aether_tenant", ActionPrefix: "tenant", ResourcePrefix: "tenant",
		GlobalResources: resourceSet("tenants", "placement_organizations", "provisioning_requests"),
		Resources:       resourceSet("tenants", "departments", "batches", "retention_policies", "legal_holds", "placement_organizations", "provisioning_requests"),
	},
	"user": {
		Audience: "aether_users", ActionPrefix: "user", ResourcePrefix: "users",
		OptionalTenantResources: resourceSet("role_assignments", "placement_department_memberships"),
		Resources:               resourceSet("profiles", "students", "student_department_memberships", "current_student_affiliations", "student_batch_affiliations", "mentor_batch_assignments", "role_assignments", "placement_department_memberships"),
	},
	"question-bank": {
		Audience: "aether_qbank", ActionPrefix: "qbank", ResourcePrefix: "qbank", Global: true,
		Resources: resourceSet("questions", "question_versions", "test_case_manifests", "question_assets", "tags", "question_version_tags"),
	},
	"assessment": {
		Audience: "aether_assessment", ActionPrefix: "assessment", ResourcePrefix: "assessment",
		Resources: resourceSet("exams", "exam_versions", "exam_sections", "exam_items", "assignment_rules", "candidate_assignments", "proctor_policies", "proctor_policy_versions", "exam_events"),
	},
	"submission": {
		Audience: "aether_submission", ActionPrefix: "submission", ResourcePrefix: "submission",
		Resources: resourceSet("attempts", "answer_revisions", "evaluation_requests", "judge_receipts", "score_summaries", "attempt_events"),
	},
	"seb": {
		Audience: "aether_seb", ActionPrefix: "seb", ResourcePrefix: "seb",
		Resources: resourceSet("configurations", "key_rotations", "sessions", "validation_events"),
	},
	"notification": {
		Audience: "aether_notification", ActionPrefix: "notification", ResourcePrefix: "notification",
		Resources: resourceSet("recipient_preferences", "notifications", "provider_idempotency_records", "delivery_attempts"),
	},
	"analytics": {
		Audience: "aether_analytics", ActionPrefix: "analytics", ResourcePrefix: "analytics",
		Resources: resourceSet("event_facts", "student_progress_rollups", "batch_progress_rollups", "exam_result_rollups", "placement_student_rollups", "report_exports"),
	},
}

func resourceSet(values ...string) map[string]struct{} {
	resources := make(map[string]struct{}, len(values))
	for _, value := range values {
		resources[value] = struct{}{}
	}
	return resources
}

// Service evaluates canonical Casbin policy for every decision, then signs a
// five-second database capability for the target service.
type Service struct {
	store                     Store
	keyring                   *centralauthz.Keyring
	identityAssertionVerifier IdentityAssertionVerifier
	requireIdentityAssertion  bool
	now                       func() time.Time
}

func NewService(
	store Store,
	keyring *centralauthz.Keyring,
	identityAssertionVerifier IdentityAssertionVerifier,
	requireIdentityAssertion bool,
) (*Service, error) {
	if store == nil {
		return nil, fmt.Errorf("authorization store is required")
	}
	if keyring == nil {
		return nil, fmt.Errorf("authorization capability keyring is required")
	}
	if requireIdentityAssertion && identityAssertionVerifier == nil {
		return nil, fmt.Errorf("identity assertion verifier is required when identity assertions are enforced")
	}
	return &Service{
		store:                     store,
		keyring:                   keyring,
		identityAssertionVerifier: identityAssertionVerifier,
		requireIdentityAssertion:  requireIdentityAssertion,
		now:                       time.Now,
	}, nil
}

// Authorize produces a fresh allow/deny decision. Any store, policy, or key
// error is returned to the caller so its request fails closed rather than
// silently falling back to stale authorization.
func (service *Service) Authorize(contextValue context.Context, request Request) (Decision, error) {
	validated, targetRoute, err := validateRequest(request)
	if err != nil {
		return Decision{}, err
	}
	if err := service.verifyIdentityAssertion(contextValue, validated); err != nil {
		return Decision{}, err
	}

	snapshot, err := service.store.Snapshot(contextValue, SnapshotQuery{
		PrincipalID:  validated.PrincipalID,
		TenantID:     validated.TenantID,
		ResourceType: validated.ResourceType,
		ResourceID:   validated.ResourceID,
	})
	if err != nil {
		return Decision{}, fmt.Errorf("load canonical authorization snapshot: %w", err)
	}
	decisionID, err := database.NewUUIDv7()
	if err != nil {
		return Decision{}, err
	}
	decision := Decision{DecisionID: decisionID, AuthzRevision: snapshot.Revision}
	if snapshot.Revision <= 0 || len(snapshot.Assignments) == 0 || len(snapshot.PolicyRules) == 0 {
		return decision, nil
	}

	engine, err := centralauthz.NewEngineFromRules(snapshot.PolicyRules)
	if err != nil {
		return Decision{}, fmt.Errorf("load canonical Casbin policy: %w", err)
	}
	casbinResource := "/" + validated.ResourceType + "/" + validated.ResourceID
	matchingScopes := make([]Scope, 0, len(snapshot.Assignments))
	for _, assignment := range snapshot.Assignments {
		if !assignmentApplies(
			assignment, validated, snapshot.TargetStudentPlacementScopes,
			snapshot.PlacementStaffScopes, snapshot.OwnedCandidateAssignments,
		) {
			continue
		}
		allowed, enforceErr := engine.Authorize(assignment.Role, assignment.ScopeKind, casbinResource, validated.Action)
		if enforceErr != nil {
			return Decision{}, fmt.Errorf("evaluate canonical Casbin policy: %w", enforceErr)
		}
		if allowed {
			matchingScopes = append(matchingScopes, Scope{Kind: assignment.ScopeKind, ID: assignment.ScopeID})
		}
	}
	if len(matchingScopes) == 0 {
		return decision, nil
	}
	decision.Allowed = true
	decision.Scopes = uniqueScopes(matchingScopes)

	databaseAction := targetRoute.ActionPrefix + "." + validated.Action
	databaseResource := targetRoute.ResourcePrefix + "." + validated.ResourceType
	capability, err := service.keyring.Issue(
		targetRoute.Audience,
		validated.PrincipalID,
		validated.TenantID,
		snapshot.Revision,
		decisionID,
		databaseAction,
		databaseResource,
		service.now(),
	)
	if err != nil {
		return Decision{}, fmt.Errorf("issue database authorization capability: %w", err)
	}
	encodedCapability, err := capability.Encode()
	if err != nil {
		return Decision{}, fmt.Errorf("encode database authorization capability: %w", err)
	}
	decision.Capability = encodedCapability
	decision.ExpiresAt = capability.ExpiresAt
	return decision, nil
}

func validateRequest(request Request) (Request, route, error) {
	request.PrincipalID = strings.ToLower(strings.TrimSpace(request.PrincipalID))
	request.TenantID = strings.ToLower(strings.TrimSpace(request.TenantID))
	request.Action = strings.ToLower(strings.TrimSpace(request.Action))
	request.ResourceType = strings.ToLower(strings.TrimSpace(request.ResourceType))
	request.ResourceID = strings.TrimSpace(request.ResourceID)
	request.RequestID = strings.ToLower(strings.TrimSpace(request.RequestID))
	request.TargetService = strings.ToLower(strings.TrimSpace(request.TargetService))
	request.IdentityAssertion = strings.TrimSpace(request.IdentityAssertion)
	if !uuidPattern.MatchString(request.PrincipalID) {
		return Request{}, route{}, &ValidationError{Field: "principal_id", Reason: "must be a UUID"}
	}
	if request.Action != "read" && request.Action != "write" {
		return Request{}, route{}, &ValidationError{Field: "action", Reason: "must be read or write"}
	}
	if !resourceTypePattern.MatchString(request.ResourceType) {
		return Request{}, route{}, &ValidationError{Field: "resource_type", Reason: "must be a lowercase database resource name"}
	}
	if !resourceIDPattern.MatchString(request.ResourceID) {
		return Request{}, route{}, &ValidationError{Field: "resource_id", Reason: "is invalid"}
	}
	if !uuidPattern.MatchString(request.RequestID) {
		return Request{}, route{}, &ValidationError{Field: "request_id", Reason: "must be a UUID"}
	}
	targetRoute, found := routes[request.TargetService]
	if !found {
		return Request{}, route{}, &ValidationError{Field: "target_service", Reason: "is not an RLS-protected platform service"}
	}
	if _, found := targetRoute.Resources[request.ResourceType]; !found {
		return Request{}, route{}, &ValidationError{Field: "resource_type", Reason: "is not protected by the target service authorization contract"}
	}
	if targetRoute.Global || hasResource(targetRoute.GlobalResources, request.ResourceType) {
		if request.TenantID != "" {
			return Request{}, route{}, &ValidationError{Field: "tenant_id", Reason: "must be empty for this global resource"}
		}
	} else if hasResource(targetRoute.OptionalTenantResources, request.ResourceType) {
		if request.TenantID != "" && !uuidPattern.MatchString(request.TenantID) {
			return Request{}, route{}, &ValidationError{Field: "tenant_id", Reason: "must be empty or a UUID for this resource"}
		}
	} else if !uuidPattern.MatchString(request.TenantID) {
		return Request{}, route{}, &ValidationError{Field: "tenant_id", Reason: "must be a UUID"}
	}
	return request, targetRoute, nil
}

func hasResource(resources map[string]struct{}, resource string) bool {
	_, found := resources[resource]
	return found
}

func (service *Service) verifyIdentityAssertion(contextValue context.Context, request Request) error {
	if !service.requireIdentityAssertion {
		return nil
	}
	if request.IdentityAssertion == "" || service.identityAssertionVerifier == nil {
		return AuthenticationError{}
	}
	identity, err := service.identityAssertionVerifier.Verify(contextValue, request.IdentityAssertion)
	if err != nil || strings.ToLower(strings.TrimSpace(identity.PrincipalID)) != request.PrincipalID {
		return AuthenticationError{}
	}
	return nil
}

func assignmentApplies(
	assignment Assignment,
	request Request,
	placementScopes map[string]struct{},
	staffScopes map[string]struct{},
	ownedCandidateAssignments map[string]struct{},
) bool {
	switch assignment.ScopeKind {
	case "platform":
		return true
	case "college", "department", "batch":
		return request.TenantID != "" && assignment.TenantID == request.TenantID
	case "placement_department":
		if (request.ResourceType != "students" && request.ResourceType != "student_batch_affiliations") || request.TenantID == "" {
			return false
		}
		_, targetApplies := placementScopes[assignment.ScopeID]
		_, staffApplies := staffScopes[assignment.ScopeID]
		return targetApplies && staffApplies
	case "self":
		if assignment.ScopeID != request.PrincipalID || assignment.TenantID != request.TenantID {
			return false
		}
		switch request.ResourceType {
		case "students", "profiles":
			return request.ResourceID == assignment.ScopeID
		case "candidate_assignments":
			_, owned := ownedCandidateAssignments[request.ResourceID]
			return owned
		case "attempts":
			// Candidate-facing Submission routes deliberately authorize with the
			// bearer subject as resource ID. Submission then binds the opaque
			// assignment/attempt to authz.current_context_actor_id() in its own
			// database procedure; this avoids a cross-service direct lookup.
			return request.ResourceID == assignment.ScopeID
		case "recipient_preferences", "notifications":
			// Notification's /me routes use the bearer subject as resource ID and
			// bind reads/writes to authz.current_context_actor_id() locally. This
			// prevents a self policy from becoming access to another recipient's
			// opaque notification ID.
			return request.ResourceID == assignment.ScopeID
		case "validation_events":
			// SEB uses the bearer subject as the authorization resource and its
			// database procedure binds that signed actor to sessions.candidate_id.
			// This grants no direct access to an opaque session or event ID.
			return request.ResourceID == assignment.ScopeID
		default:
			return false
		}
	default:
		return false
	}
}

func uniqueScopes(scopes []Scope) []Scope {
	sort.Slice(scopes, func(left, right int) bool {
		if scopes[left].Kind == scopes[right].Kind {
			return scopes[left].ID < scopes[right].ID
		}
		return scopes[left].Kind < scopes[right].Kind
	})
	unique := scopes[:0]
	for _, scope := range scopes {
		if len(unique) == 0 || unique[len(unique)-1] != scope {
			unique = append(unique, scope)
		}
	}
	return unique
}
