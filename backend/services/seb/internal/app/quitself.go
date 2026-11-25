package app

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/database"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
)

type IssueLockdownQuitSession struct {
	ID             string
	EventID        string
	TenantID       string
	AttemptID      string
	ExamID         string
	ExamVersionID  string
	ExpiresAt      time.Time
	IdempotencyKey string
	RequestHash    string
}

type RedeemQuitToken struct {
	TenantID string
	Token    string
}

type QuitRedemption struct {
	QuitPassword string `json:"quit_password"`
}

func (service *Service) IssueLockdownQuitSession(ctx context.Context, capability centralauthz.Capability, command IssueLockdownQuitSession) (IssuedSession, error) {
	if !isUUID(command.ID) || !isUUID(command.EventID) || !isUUID(command.TenantID) ||
		!isUUID(command.AttemptID) || !isUUID(command.ExamID) || !isUUID(command.ExamVersionID) {
		return IssuedSession{}, invalid("lockdown quit session IDs are invalid")
	}
	now := service.now().UTC()
	if command.ExpiresAt.IsZero() || !command.ExpiresAt.After(now) || command.ExpiresAt.After(now.Add(24*time.Hour)) {
		return IssuedSession{}, invalid("session expiry must be within the next 24 hours")
	}
	if err := validateIdempotency(command.IdempotencyKey, command.RequestHash); err != nil {
		return IssuedSession{}, err
	}
	if !strings.EqualFold(strings.TrimSpace(capability.TenantID), strings.TrimSpace(command.TenantID)) {
		return IssuedSession{}, apperrors.New(apperrors.CodeForbidden, "authorization tenant scope does not match request")
	}
	if capability.ActorID == "" {
		return IssuedSession{}, apperrors.New(apperrors.CodeUnauthorized, "a candidate identity is required")
	}

	var quitToken string
	var result Session
	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		operation, opErr := scopedIdempotencyOperation(capability, command.TenantID, "seb.lockdown_quit_session.issue", command.AttemptID)
		if opErr != nil {
			return opErr
		}
		claim, claimErr := service.claimIdempotency(ctx, transaction, capability, command.TenantID, operation, command.IdempotencyKey, command.RequestHash)
		if claimErr != nil {
			return claimErr
		}
		if !claim.Acquired {
			var replay IssuedSession
			if decodeErr := decodeReplay(claim, 201, &replay); decodeErr != nil {
				return decodeErr
			}
			result = replay.Session
			return apperrors.New(apperrors.CodeConflict, "session issuance already completed; the one-time quit token cannot be replayed")
		}

		var genErr error
		quitToken, _, genErr = newQuitToken()
		if genErr != nil {
			return genErr
		}
		tokenHash := HashHeaderValue(quitToken)
		var issueErr error
		result, issueErr = service.store.IssueLockdownQuitSession(ctx, transaction, command, tokenHash, capability.ActorID)
		if issueErr != nil {
			return issueErr
		}
		safe := issuedSessionReplay{Session: result}
		return service.completeIdempotency(ctx, transaction, capability, command.TenantID, operation, command.IdempotencyKey, 201, safe)
	})
	if err != nil {
		return IssuedSession{}, err
	}
	return IssuedSession{Session: result, QuitToken: quitToken}, nil
}

func (service *Service) RedeemQuitToken(ctx context.Context, capability centralauthz.Capability, command RedeemQuitToken) (QuitRedemption, error) {
	token := strings.TrimSpace(command.Token)
	if !isUUID(command.TenantID) || token == "" || len(token) > 255 {
		return QuitRedemption{}, invalid("quit token redemption fields are invalid")
	}
	if service.launch.QuitSecret == "" {
		return QuitRedemption{}, apperrors.New(apperrors.CodeUnavailable, "SEB launch files are not configured")
	}

	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		return service.store.RedeemQuitToken(ctx, transaction, HashHeaderValue(token))
	})
	if err != nil {
		return QuitRedemption{}, err
	}
	return QuitRedemption{QuitPassword: service.launch.QuitSecret}, nil
}
