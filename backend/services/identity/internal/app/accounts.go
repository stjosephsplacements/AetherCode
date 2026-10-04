package app

import (
	"context"
	"fmt"
	"strings"
	"sync"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/services/identity/internal/domain"
)

// MaxProvisionedAccounts bounds one provisioning call. An import names one
// batch, and 500 Argon2id hashes take about 4 s on the campus server, well
// inside the 10 s request timeout.
const MaxProvisionedAccounts = 500

// hashWorkers bounds concurrent Argon2id work (64 MiB each, about 1 GiB in
// total). Throughput stops improving beyond this on the campus server.
const hashWorkers = 16

// AccountStore is the persistence port for administrator-provisioned
// accounts (ADR-0019). Every method is all-or-nothing.
type AccountStore interface {
	ProvisionAccounts(context.Context, []NewAccount, AccountAudit) error
	SetPasswords(context.Context, []PasswordAssignment, AccountAudit) ([]AccountName, error)
	SetAccountStatus(context.Context, []string, string, AccountAudit) error
	DiscardAccounts(context.Context, []string, AccountAudit) error
}

// AccountAudit names the administrator and request behind an account change.
// Identity records it in auth_events for every affected principal.
type AccountAudit struct {
	ActorID   string
	RequestID string
}

// AccountRequest describes one account an administrator provisions. Username
// is required; email is optional.
type AccountRequest struct {
	Username    string `json:"username"`
	Email       string `json:"email,omitempty"`
	DisplayName string `json:"display_name"`
}

// NewAccount is the persistence-safe provisioning command.
type NewAccount struct {
	PrincipalID  string
	Username     string
	Email        string
	DisplayName  string
	PasswordHash string
}

// AccountName is how a principal signs in and is addressed on login slips.
type AccountName struct {
	PrincipalID string
	Username    string
	DisplayName string
}

// PasswordAssignment replaces one principal's password.
type PasswordAssignment struct {
	PrincipalID  string
	PasswordHash string
}

// IssuedCredential is the only place a generated password leaves Identity.
// It is returned once to the provisioning caller and never stored.
type IssuedCredential struct {
	PrincipalID string `json:"principal_id"`
	Username    string `json:"username,omitempty"`
	DisplayName string `json:"display_name"`
	Password    string `json:"password"`
}

// ProvisionAccounts creates active accounts with generated passwords. A
// conflict on any username or email rejects the whole call.
func (service *Service) ProvisionAccounts(contextValue context.Context, requests []AccountRequest, audit AccountAudit) ([]IssuedCredential, error) {
	if err := validAudit(audit); err != nil {
		return nil, err
	}
	if len(requests) == 0 || len(requests) > MaxProvisionedAccounts {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, fmt.Sprintf("between 1 and %d accounts are required", MaxProvisionedAccounts))
	}
	accounts := make([]NewAccount, len(requests))
	seen := make(map[string]bool, 2*len(requests))
	for index, request := range requests {
		username := strings.ToLower(strings.TrimSpace(request.Username))
		email := normalizeEmail(request.Email)
		displayName := strings.TrimSpace(request.DisplayName)
		if !usernamePattern.MatchString(username) {
			return nil, apperrors.New(apperrors.CodeInvalidArgument, fmt.Sprintf("username %q is invalid", request.Username))
		}
		if email != "" && !emailPattern.MatchString(email) {
			return nil, apperrors.New(apperrors.CodeInvalidArgument, fmt.Sprintf("email for %q is invalid", username))
		}
		if length := len([]rune(displayName)); length < 1 || length > 200 {
			return nil, apperrors.New(apperrors.CodeInvalidArgument, fmt.Sprintf("display name for %q must contain between 1 and 200 characters", username))
		}
		for _, key := range []string{username, email} {
			if key == "" {
				continue
			}
			if seen[key] {
				return nil, apperrors.New(apperrors.CodeInvalidArgument, fmt.Sprintf("%q appears more than once", key))
			}
			seen[key] = true
		}
		principalID, err := service.newID()
		if err != nil {
			return nil, err
		}
		accounts[index] = NewAccount{PrincipalID: principalID, Username: username, Email: email, DisplayName: displayName}
	}
	ids := make([]string, len(accounts))
	for index, account := range accounts {
		ids[index] = account.PrincipalID
	}
	credentials, hashes, err := generateCredentials(ids)
	if err != nil {
		return nil, err
	}
	for index := range accounts {
		accounts[index].PasswordHash = hashes[index]
		credentials[index].Username = accounts[index].Username
		credentials[index].DisplayName = accounts[index].DisplayName
	}
	if err := service.store.ProvisionAccounts(contextValue, accounts, audit); err != nil {
		return nil, err
	}
	return credentials, nil
}

// ReissuePasswords gives each principal a new generated password, unlocks it,
// and ends its sessions.
func (service *Service) ReissuePasswords(contextValue context.Context, principalIDs []string, audit AccountAudit) ([]IssuedCredential, error) {
	if err := validAudit(audit); err != nil {
		return nil, err
	}
	ids, err := normalizePrincipalIDs(principalIDs)
	if err != nil {
		return nil, err
	}
	credentials, hashes, err := generateCredentials(ids)
	if err != nil {
		return nil, err
	}
	assignments := make([]PasswordAssignment, len(ids))
	for index, id := range ids {
		assignments[index] = PasswordAssignment{PrincipalID: id, PasswordHash: hashes[index]}
	}
	names, err := service.store.SetPasswords(contextValue, assignments, audit)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]AccountName, len(names))
	for _, name := range names {
		byID[name.PrincipalID] = name
	}
	for index := range credentials {
		credentials[index].Username = byID[credentials[index].PrincipalID].Username
		credentials[index].DisplayName = byID[credentials[index].PrincipalID].DisplayName
	}
	return credentials, nil
}

// SetAccountStatus enables ("active") or disables ("disabled") accounts.
// Disabling ends every session immediately.
func (service *Service) SetAccountStatus(contextValue context.Context, principalIDs []string, status string, audit AccountAudit) error {
	if err := validAudit(audit); err != nil {
		return err
	}
	if status != "active" && status != "disabled" {
		return apperrors.New(apperrors.CodeInvalidArgument, "status must be active or disabled")
	}
	ids, err := normalizePrincipalIDs(principalIDs)
	if err != nil {
		return err
	}
	return service.store.SetAccountStatus(contextValue, ids, status, audit)
}

// DiscardAccounts soft-deletes accounts the caller just provisioned but could
// not complete (for example when the student enrollment that follows fails),
// so their usernames are free for a retry.
func (service *Service) DiscardAccounts(contextValue context.Context, principalIDs []string, audit AccountAudit) error {
	if err := validAudit(audit); err != nil {
		return err
	}
	ids, err := normalizePrincipalIDs(principalIDs)
	if err != nil {
		return err
	}
	return service.store.DiscardAccounts(contextValue, ids, audit)
}

func validAudit(audit AccountAudit) error {
	if !isUUID(audit.ActorID) || !isUUID(audit.RequestID) {
		return apperrors.New(apperrors.CodeInvalidArgument, "actor and request IDs must be UUIDs")
	}
	return nil
}

func normalizePrincipalIDs(principalIDs []string) ([]string, error) {
	if len(principalIDs) == 0 || len(principalIDs) > MaxProvisionedAccounts {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, fmt.Sprintf("between 1 and %d principal IDs are required", MaxProvisionedAccounts))
	}
	ids := make([]string, len(principalIDs))
	seen := make(map[string]bool, len(principalIDs))
	for index, id := range principalIDs {
		id = strings.ToLower(strings.TrimSpace(id))
		if !isUUID(id) || seen[id] {
			return nil, apperrors.New(apperrors.CodeInvalidArgument, "principal IDs must be distinct UUIDs")
		}
		seen[id] = true
		ids[index] = id
	}
	return ids, nil
}

// generateCredentials creates and hashes one password per principal, hashing
// on a bounded worker pool.
func generateCredentials(principalIDs []string) ([]IssuedCredential, []string, error) {
	credentials := make([]IssuedCredential, len(principalIDs))
	for index, id := range principalIDs {
		password, err := domain.GeneratePassword()
		if err != nil {
			return nil, nil, err
		}
		credentials[index] = IssuedCredential{PrincipalID: id, Password: password}
	}
	hashes := make([]string, len(principalIDs))
	errs := make([]error, len(principalIDs))
	indexes := make(chan int)
	var workers sync.WaitGroup
	for range hashWorkers {
		workers.Go(func() {
			for index := range indexes {
				hashes[index], errs[index] = domain.HashPassword(credentials[index].Password)
			}
		})
	}
	for index := range principalIDs {
		indexes <- index
	}
	close(indexes)
	workers.Wait()
	for _, err := range errs {
		if err != nil {
			return nil, nil, fmt.Errorf("hash generated password: %w", err)
		}
	}
	return credentials, hashes, nil
}
