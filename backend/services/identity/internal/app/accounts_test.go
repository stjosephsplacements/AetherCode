package app

import (
	"context"
	"strings"
	"testing"

	"github.com/aethercode/aethercode/services/identity/internal/domain"
)

var testAudit = AccountAudit{ActorID: testPrincipalID, RequestID: testAccessID}

func TestProvisionAccountsHashesGeneratedPasswords(t *testing.T) {
	t.Parallel()
	store := &memoryStore{}
	service := newTestService(t, store)
	credentials, err := service.ProvisionAccounts(context.Background(), []AccountRequest{
		{Username: " 22CS001 ", DisplayName: "Asha Kumar"},
		{Username: "faculty.one", Email: "Faculty@College.edu", DisplayName: "Faculty One"},
	}, testAudit)
	if err != nil {
		t.Fatalf("ProvisionAccounts() error = %v", err)
	}
	if len(credentials) != 2 || len(store.provisioned) != 2 {
		t.Fatalf("credentials = %#v, stored = %#v", credentials, store.provisioned)
	}
	first := store.provisioned[0]
	if first.Username != "22cs001" || first.Email != "" || credentials[0].Username != "22cs001" {
		t.Fatalf("first account = %#v / %#v, want lowercase username without email", first, credentials[0])
	}
	if store.provisioned[1].Email != "faculty@college.edu" {
		t.Fatalf("email = %q, want normalized", store.provisioned[1].Email)
	}
	for index, account := range store.provisioned {
		if account.PrincipalID != credentials[index].PrincipalID {
			t.Fatalf("credential %d names %q, stored %q", index, credentials[index].PrincipalID, account.PrincipalID)
		}
		if strings.Contains(account.PasswordHash, credentials[index].Password) || !domain.VerifyPassword(account.PasswordHash, credentials[index].Password) {
			t.Fatalf("account %d does not store a hash of its generated password", index)
		}
	}
}

func TestProvisionAccountsRejectsBadInputBeforeStorage(t *testing.T) {
	t.Parallel()
	for name, requests := range map[string][]AccountRequest{
		"empty":               nil,
		"username with @":     {{Username: "a@b.com", DisplayName: "A"}},
		"username with space": {{Username: "22 cs", DisplayName: "A"}},
		"duplicate username":  {{Username: "22cs001", DisplayName: "A"}, {Username: "22CS001", DisplayName: "B"}},
		"missing name":        {{Username: "22cs001"}},
		"bad email":           {{Username: "22cs001", Email: "not-an-email", DisplayName: "A"}},
		"too many":            make([]AccountRequest, MaxProvisionedAccounts+1),
	} {
		store := &memoryStore{}
		if _, err := newTestService(t, store).ProvisionAccounts(context.Background(), requests, testAudit); err == nil || store.provisioned != nil {
			t.Fatalf("%s: ProvisionAccounts() accepted invalid input", name)
		}
	}
}

func TestAccountChangesRequireAudit(t *testing.T) {
	t.Parallel()
	service := newTestService(t, &memoryStore{})
	if err := service.SetAccountStatus(context.Background(), []string{testPrincipalID}, "disabled", AccountAudit{}); err == nil {
		t.Fatal("SetAccountStatus() accepted a change without an actor")
	}
	if err := service.SetAccountStatus(context.Background(), []string{testPrincipalID}, "deleted", testAudit); err == nil {
		t.Fatal("SetAccountStatus() accepted an unknown status")
	}
	if _, err := service.ReissuePasswords(context.Background(), []string{testPrincipalID, testPrincipalID}, testAudit); err == nil {
		t.Fatal("ReissuePasswords() accepted duplicate principals")
	}
}

func TestLoginAcceptsUsernameIdentifier(t *testing.T) {
	t.Parallel()
	store := &memoryStore{session: Session{PrincipalID: testPrincipalID}}
	service := newTestService(t, store)
	if _, err := service.Login(context.Background(), " 22CS001 ", "AetherCode2026", "", "", "", testAccessID); err != nil {
		t.Fatalf("Login() error = %v", err)
	}
	if store.login.Identifier != "22cs001" {
		t.Fatalf("login identifier = %q, want lowercase username", store.login.Identifier)
	}
	if _, err := service.Login(context.Background(), "has space", "AetherCode2026", "", "", "", testAccessID); err == nil {
		t.Fatal("Login() accepted an identifier that is neither an email nor a username")
	}
}
