package app

import (
	"context"
	"log/slog"
	"strings"
	"time"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/services/identity/internal/domain"
)

// Single sign-on through the college's identity provider (ADR-0042). A
// person who signs in there is linked to the AetherCode account with the same
// username and then signs in as that account. AetherCode never creates an
// account at sign-in: accounts carry a college, roles and batches only staff
// can give. AetherCode's own password sign-in stays, so an exam never depends
// on the provider.

// SSOStart is where to send the browser, with values the caller keeps for the
// callback.
type SSOStart struct {
	AuthorizationURL string `json:"authorization_url"`
	State            string `json:"state"`
	Verifier         string `json:"code_verifier"`
}

// SSOIdentity is the provider's signed-in user.
type SSOIdentity struct {
	Subject  string
	Username string
	Name     string
}

// SSOLogin starts a session for the account linked to Identity.
type SSOLogin struct {
	Identity         SSOIdentity
	RefreshFamilyID  string
	RefreshTokenID   string
	RefreshTokenHash []byte
	RefreshExpiresAt time.Time
	AccessTokenID    string
	AccessExpiresAt  time.Time
	RequestIP        string
	UserAgent        string
	RequestID        string
}

// DirectoryAccount is an AetherCode account as the provider gets it.
type DirectoryAccount struct {
	PrincipalID  string
	Username     string
	Email        string
	DisplayName  string
	PasswordHash string
	MustChange   bool
	// DirectoryUserID is the linked provider account, if any, and
	// CreatedHere whether AetherCode created it.
	DirectoryUserID string
	CreatedHere     bool
	RequestedAt     time.Time
}

// SSOProvider is the provider's sign-in and directory API.
type SSOProvider interface {
	Start(context.Context) (SSOStart, error)
	Identify(context.Context, string, string) (SSOIdentity, error)
	DirectoryEnabled() bool
	FindUser(context.Context, string) (string, error)
	CreateUser(context.Context, DirectoryAccount) (string, error)
	UpdateUser(context.Context, string, DirectoryAccount) error
}

// SSOStore is the persistence SSO needs.
type SSOStore interface {
	AuthenticateSSO(context.Context, SSOLogin) (Session, error)
	DueDirectorySync(context.Context, int) ([]DirectoryAccount, error)
	LinkDirectoryUser(context.Context, string, string, bool) error
	FinishDirectorySync(context.Context, string, time.Time, error) error
}

// UseSSO turns single sign-on on.
func (service *Service) UseSSO(provider SSOProvider, store SSOStore) {
	service.sso, service.ssoStore = provider, store
}

// SSOEnabled reports whether single sign-on is configured.
func (service *Service) SSOEnabled() bool { return service.sso != nil }

func (service *Service) StartSSO(contextValue context.Context) (SSOStart, error) {
	if service.sso == nil {
		return SSOStart{}, apperrors.New(apperrors.CodeNotFound, "single sign-on is not configured")
	}
	start, err := service.sso.Start(contextValue)
	if err != nil {
		return SSOStart{}, apperrors.New(apperrors.CodeUnavailable, "the sign-in service is unreachable; use your AetherCode password")
	}
	return start, nil
}

// CompleteSSO finishes a sign-in: it exchanges the provider's code and
// starts a session for the linked account.
func (service *Service) CompleteSSO(contextValue context.Context, code, verifier, requestIP, userAgent, requestID string) (TokenPair, error) {
	if service.sso == nil {
		return TokenPair{}, apperrors.New(apperrors.CodeNotFound, "single sign-on is not configured")
	}
	code, verifier = strings.TrimSpace(code), strings.TrimSpace(verifier)
	if code == "" || len(code) > 2048 || len(verifier) < 43 || len(verifier) > 128 {
		return TokenPair{}, apperrors.New(apperrors.CodeInvalidArgument, "the sign-in response is incomplete")
	}
	identity, err := service.sso.Identify(contextValue, code, verifier)
	if err != nil {
		return TokenPair{}, apperrors.New(apperrors.CodeUnauthorized, "the sign-in could not be confirmed; try again")
	}
	identity.Username = DirectoryUsername(identity.Username)
	refreshToken, err := service.newOpaqueToken()
	if err != nil {
		return TokenPair{}, err
	}
	refreshHash := domain.HashToken(refreshToken)
	ids := make([]string, 3)
	for index := range ids {
		if ids[index], err = service.newID(); err != nil {
			return TokenPair{}, err
		}
	}
	now := service.now().UTC()
	session, err := service.ssoStore.AuthenticateSSO(contextValue, SSOLogin{
		Identity: identity, RefreshFamilyID: ids[0], RefreshTokenID: ids[1], RefreshTokenHash: refreshHash[:],
		RefreshExpiresAt: now.Add(service.refreshTokenLifetime), AccessTokenID: ids[2],
		AccessExpiresAt: now.Add(service.accessTokenLifetime), RequestIP: strings.TrimSpace(requestIP),
		UserAgent: strings.TrimSpace(userAgent), RequestID: strings.TrimSpace(requestID),
	})
	if err != nil {
		return TokenPair{}, err
	}
	return service.issueTokenPair(session, ids[2], refreshToken, now)
}

// DirectoryUsername is a provider login name as an AetherCode username: the
// provider may append "@<organization domain>" to it.
func DirectoryUsername(loginName string) string {
	loginName = strings.ToLower(strings.TrimSpace(loginName))
	if at := strings.LastIndex(loginName, "@"); at > 0 && usernamePattern.MatchString(loginName[:at]) {
		return loginName[:at]
	}
	return loginName
}

// RunDirectorySync copies accounts to the provider until the context ends.
// An account is linked, never duplicated: when the provider already has the
// username (created in another app), AetherCode links to it and leaves its
// password alone; it keeps passwords in step only for accounts it created.
func (service *Service) RunDirectorySync(contextValue context.Context, logger *slog.Logger) {
	if service.sso == nil || !service.sso.DirectoryEnabled() {
		return
	}
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		accounts, err := service.ssoStore.DueDirectorySync(contextValue, 25)
		if err != nil && contextValue.Err() == nil {
			logger.Warn("directory sync", "error", err)
		}
		for _, account := range accounts {
			syncErr := service.syncAccount(contextValue, account)
			if syncErr != nil {
				logger.Warn("directory sync account", "principal_id", account.PrincipalID, "error", syncErr)
			}
			if err := service.ssoStore.FinishDirectorySync(contextValue, account.PrincipalID, account.RequestedAt, syncErr); err != nil {
				logger.Warn("record directory sync", "principal_id", account.PrincipalID, "error", err)
			}
		}
		select {
		case <-contextValue.Done():
			return
		case <-ticker.C:
		}
	}
}

func (service *Service) syncAccount(contextValue context.Context, account DirectoryAccount) error {
	if account.DirectoryUserID != "" {
		if !account.CreatedHere {
			return nil
		}
		return service.sso.UpdateUser(contextValue, account.DirectoryUserID, account)
	}
	existing, err := service.sso.FindUser(contextValue, account.Username)
	if err != nil {
		return err
	}
	if existing != "" {
		return service.ssoStore.LinkDirectoryUser(contextValue, account.PrincipalID, existing, false)
	}
	created, err := service.sso.CreateUser(contextValue, account)
	if err != nil {
		return err
	}
	return service.ssoStore.LinkDirectoryUser(contextValue, account.PrincipalID, created, true)
}
