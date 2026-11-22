package repo

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
	"github.com/stjosephsplacements/AetherCode/services/seb/internal/app"
)

func (repository *Postgres) IssueLockdownQuitSession(
	ctx context.Context,
	transaction pgx.Tx,
	command app.IssueLockdownQuitSession,
	tokenHash, candidateID string,
) (app.Session, error) {
	var session app.Session
	err := transaction.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, configuration_id::text, attempt_id::text,
			candidate_id::text, lifecycle_state, issued_at, activated_at, closed_at,
			expires_at, COALESCE(closed_reason, ''), version
		FROM seb.issue_lockdown_quit_session($1, $2, $3, $4, $5, $6, $7, $8::char(64))
	`, command.ID, command.EventID, command.TenantID, command.AttemptID,
		command.ExamID, command.ExamVersionID, command.ExpiresAt.UTC(), tokenHash).Scan(
		&session.ID, &session.TenantID, &session.ConfigurationID, &session.AttemptID,
		&session.CandidateID, &session.LifecycleState, &session.IssuedAt,
		&session.ActivatedAt, &session.ClosedAt, &session.ExpiresAt,
		&session.ClosedReason, &session.Version,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Session{}, apperrors.New(apperrors.CodeConflict, "lockdown quit session could not be issued")
	}
	if err != nil {
		return app.Session{}, mapWriteError(err, "lockdown quit session could not be issued")
	}
	if session.CandidateID != candidateID {
		return app.Session{}, apperrors.New(apperrors.CodeForbidden, "lockdown quit session candidate mismatch")
	}
	return session, nil
}

func (repository *Postgres) RedeemQuitToken(ctx context.Context, transaction pgx.Tx, tokenHash string) error {
	_, err := transaction.Exec(ctx, `SELECT seb.redeem_quit_token($1::char(64))`, tokenHash)
	if err != nil {
		return mapWriteError(err, "quit token redemption was rejected")
	}
	return nil
}