package app

import (
	"errors"
	"testing"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
)

func TestSelfReturnsTheVerifiedCallersRoles(t *testing.T) {
	t.Parallel()
	tenant := "018f4b0d-08f8-7c09-9ba7-efdf9c2200aa"
	store := fakeStore{snapshot: Snapshot{Assignments: []Assignment{
		{Role: centralauthz.RoleStudent, ScopeKind: "self", TenantID: tenant, ScopeID: testPrincipal},
		{Role: centralauthz.Role("mentor"), ScopeKind: "batch", TenantID: tenant, ScopeID: tenant},
	}}}
	service, err := NewService(store, testKeyring(t), fakeIdentityAssertionVerifier{identity: VerifiedIdentity{PrincipalID: testPrincipal}}, true)
	if err != nil {
		t.Fatal(err)
	}
	self, err := service.Self(t.Context(), "assertion")
	if err != nil {
		t.Fatal(err)
	}
	if self.PrincipalID != testPrincipal || len(self.Roles) != 2 || self.Student == nil || self.Student.TenantID != tenant {
		t.Fatalf("self = %+v", self)
	}
}

func TestSelfRefusesAnUnverifiedCaller(t *testing.T) {
	t.Parallel()
	for name, verifier := range map[string]IdentityAssertionVerifier{
		"no verifier":       nil,
		"invalid assertion": fakeIdentityAssertionVerifier{err: errors.New("bad signature")},
		"not a principal":   fakeIdentityAssertionVerifier{identity: VerifiedIdentity{PrincipalID: "admin"}},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			service := &Service{store: fakeStore{}, identityAssertionVerifier: verifier}
			if _, err := service.Self(t.Context(), "assertion"); !errors.As(err, new(AuthenticationError)) {
				t.Fatalf("Self() error = %v, want AuthenticationError", err)
			}
		})
	}
	service := &Service{store: fakeStore{}, identityAssertionVerifier: fakeIdentityAssertionVerifier{identity: VerifiedIdentity{PrincipalID: testPrincipal}}}
	if _, err := service.Self(t.Context(), ""); !errors.As(err, new(AuthenticationError)) {
		t.Fatalf("an empty assertion must be refused, got %v", err)
	}
}

func TestSelfOfAPrincipalWithoutRoles(t *testing.T) {
	t.Parallel()
	service := &Service{store: fakeStore{}, identityAssertionVerifier: fakeIdentityAssertionVerifier{identity: VerifiedIdentity{PrincipalID: testPrincipal}}}
	self, err := service.Self(t.Context(), "assertion")
	if err != nil || self.Roles == nil || len(self.Roles) != 0 || self.Student != nil {
		t.Fatalf("self = %+v, err = %v", self, err)
	}
}
