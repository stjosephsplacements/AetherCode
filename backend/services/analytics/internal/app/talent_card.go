package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/database"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
	"github.com/stjosephsplacements/AetherCode/services/analytics/internal/talentcard"
)

// TalentCardValidity is how long a card stays good; a short life limits how stale a
// recruiter's copy can be (ADR-0081).
const TalentCardValidity = 90 * 24 * time.Hour

// TalentCardIdentity is what the issuer attests about the student. Analytics holds
// scores, not names; the identity comes from the staff member who can see the
// student record, and the signature binds it to the figures.
type TalentCardIdentity struct {
	DisplayName string `json:"display_name"`
	College     string `json:"college"`
	Department  string `json:"department"`
	RollNumber  string `json:"roll_number"`
	Email       string `json:"email"`
	Phone       string `json:"phone"`
}

// TalentCardConsent is the student's own choice.
type TalentCardConsent struct {
	Granted          bool `json:"granted"`
	ShareContactInfo bool `json:"share_contact_info"`
	BlindEvaluation  bool `json:"blind_evaluation"`
}

// IssuedTalentCard is the one copy of a card's token; Analytics does not keep it.
type IssuedTalentCard struct {
	ID        string    `json:"id"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}

// TalentCards issues, revokes and verifies talent cards.
type TalentCards struct {
	pool   *pgxpool.Pool
	signer *talentcard.Signer
	now    func() time.Time
}

func NewTalentCards(pool *pgxpool.Pool, signer *talentcard.Signer) (*TalentCards, error) {
	if pool == nil || signer == nil {
		return nil, fmt.Errorf("talent card database pool and signer are required")
	}
	return &TalentCards{pool: pool, signer: signer, now: time.Now}, nil
}

func (identity TalentCardIdentity) validate() error {
	tooLong := func(value string, limit int) bool {
		return len(value) > limit || strings.ContainsAny(value, "\r\n\x00")
	}
	switch {
	case strings.TrimSpace(identity.DisplayName) == "" || tooLong(identity.DisplayName, 120),
		tooLong(identity.College, 120), tooLong(identity.Department, 120), tooLong(identity.RollNumber, 40),
		tooLong(identity.Email, 254), tooLong(identity.Phone, 20):
		return invalid("talent card identity fields are invalid")
	case identity.Email != "" && !strings.Contains(identity.Email, "@"):
		return invalid("talent card email is invalid")
	}
	return nil
}

// metrics mirrors analytics.talent_card_metrics.
type talentMetrics struct {
	ExamCount        int      `json:"exam_count"`
	TopPercent       *int     `json:"top_percent"`
	Accuracy         *float64 `json:"accuracy"`
	Evaluations      int      `json:"evaluations"`
	SpeedIndex       *int     `json:"speed_index"`
	ShareContactInfo bool     `json:"share_contact_info"`
	BlindEvaluation  bool     `json:"blind_evaluation"`
}

// claimsFor builds the claim set, leaving out what consent or blind evaluation hides.
func claimsFor(id string, issued, expires time.Time, identity TalentCardIdentity, metrics talentMetrics) talentcard.Claims {
	claims := talentcard.Claims{
		CardID: id, IssuedAt: issued.Unix(), ExpiresAt: expires.Unix(),
		ExamCount: metrics.ExamCount, TopPercent: metrics.TopPercent, Accuracy: metrics.Accuracy,
		Evaluations: metrics.Evaluations, SpeedIndex: metrics.SpeedIndex,
	}
	if !metrics.BlindEvaluation {
		claims.Name, claims.College, claims.Department = identity.DisplayName, identity.College, identity.Department
	}
	if metrics.ShareContactInfo {
		claims.RollNumber, claims.Email, claims.Phone = identity.RollNumber, identity.Email, identity.Phone
	}
	return claims
}

// Issue computes the student's figures, signs them and records the card, in one
// transaction under the caller's single-use capability.
func (cards *TalentCards) Issue(ctx context.Context, capability centralauthz.Capability, tenantID, studentID string, identity TalentCardIdentity) (IssuedTalentCard, error) {
	if !validID(tenantID) || !validID(studentID) {
		return IssuedTalentCard{}, invalid("talent card tenant and student are required")
	}
	if err := identity.validate(); err != nil {
		return IssuedTalentCard{}, err
	}
	cardID, err := database.NewUUIDv7()
	if err != nil {
		return IssuedTalentCard{}, fmt.Errorf("generate talent card id: %w", err)
	}
	issued := cards.now().UTC()
	expires := issued.Add(TalentCardValidity)
	var token string
	err = database.WithTenantTx(ctx, cards.pool, capability, func(transaction pgx.Tx) error {
		var raw []byte
		if err := transaction.QueryRow(ctx, `SELECT analytics.talent_card_metrics($1, $2)`, tenantID, studentID).Scan(&raw); err != nil {
			return err
		}
		var metrics talentMetrics
		if err := json.Unmarshal(raw, &metrics); err != nil {
			return fmt.Errorf("decode talent card metrics: %w", err)
		}
		var signErr error
		if token, signErr = cards.signer.Sign(claimsFor(cardID, issued, expires, identity, metrics)); signErr != nil {
			return signErr
		}
		_, err := transaction.Exec(ctx, `SELECT analytics.store_talent_card($1, $2, $3, $4)`, cardID, tenantID, studentID, expires)
		return err
	})
	if err != nil {
		return IssuedTalentCard{}, mapTalentCardError(err)
	}
	return IssuedTalentCard{ID: cardID, Token: token, ExpiresAt: expires}, nil
}

// SetConsent records the student's own choice; withdrawing it revokes their cards.
func (cards *TalentCards) SetConsent(ctx context.Context, capability centralauthz.Capability, tenantID, studentID string, consent TalentCardConsent) error {
	if !validID(tenantID) || !validID(studentID) {
		return invalid("talent card consent tenant and student are required")
	}
	err := database.WithTenantTx(ctx, cards.pool, capability, func(transaction pgx.Tx) error {
		_, err := transaction.Exec(ctx, `SELECT analytics.set_talent_card_consent($1, $2, $3, $4, $5)`,
			tenantID, studentID, consent.Granted, consent.ShareContactInfo, consent.BlindEvaluation)
		return err
	})
	return mapTalentCardError(err)
}

// GetConsent returns the student's current choice (nothing agreed until they act).
func (cards *TalentCards) GetConsent(ctx context.Context, capability centralauthz.Capability, tenantID, studentID string) (TalentCardConsent, error) {
	if !validID(tenantID) || !validID(studentID) {
		return TalentCardConsent{}, invalid("talent card consent tenant and student are required")
	}
	var consent TalentCardConsent
	err := database.WithTenantTx(ctx, cards.pool, capability, func(transaction pgx.Tx) error {
		var raw []byte
		if err := transaction.QueryRow(ctx, `SELECT analytics.get_talent_card_consent($1, $2)`, tenantID, studentID).Scan(&raw); err != nil {
			return err
		}
		return json.Unmarshal(raw, &consent)
	})
	return consent, mapTalentCardError(err)
}

// Revoke ends a card at once; the public check refuses it from then on.
func (cards *TalentCards) Revoke(ctx context.Context, capability centralauthz.Capability, tenantID, cardID string) error {
	if !validID(tenantID) || !validID(cardID) {
		return invalid("talent card tenant and id are required")
	}
	err := database.WithTenantTx(ctx, cards.pool, capability, func(transaction pgx.Tx) error {
		var revoked bool
		if err := transaction.QueryRow(ctx, `SELECT analytics.revoke_talent_card($1, $2)`, tenantID, cardID).Scan(&revoked); err != nil {
			return err
		}
		if !revoked {
			return apperrors.New(apperrors.CodeNotFound, "talent card was not found or is already revoked")
		}
		return nil
	})
	return mapTalentCardError(err)
}

// Verify is the public check: the signature, the expiry, then revocation and consent.
func (cards *TalentCards) Verify(ctx context.Context, token string) (talentcard.Claims, error) {
	notValid := apperrors.New(apperrors.CodeNotFound, "talent card is not valid")
	claims, err := cards.signer.Verify(token)
	if err != nil || claims.ExpiresAt <= cards.now().Unix() {
		return talentcard.Claims{}, notValid
	}
	if _, parseErr := uuid.Parse(claims.CardID); parseErr != nil {
		return talentcard.Claims{}, notValid
	}
	var valid bool
	if err := cards.pool.QueryRow(ctx, `SELECT analytics.talent_card_is_valid($1::uuid)`, claims.CardID).Scan(&valid); err != nil {
		return talentcard.Claims{}, fmt.Errorf("check talent card: %w", err)
	}
	if !valid {
		return talentcard.Claims{}, notValid
	}
	// The token was signed with the contact details the student agreed to share at the time; honour a later change.
	var sharesContact bool
	if err := cards.pool.QueryRow(ctx, `SELECT analytics.talent_card_shares_contact($1::uuid)`, claims.CardID).Scan(&sharesContact); err != nil {
		return talentcard.Claims{}, fmt.Errorf("check talent card contact consent: %w", err)
	}
	if !sharesContact {
		claims.Email, claims.Phone = "", ""
	}
	return claims, nil
}

// mapTalentCardError turns the functions' deliberate refusals into client errors.
func mapTalentCardError(err error) error {
	var pgError *pgconn.PgError
	if errors.As(err, &pgError) {
		switch pgError.Code {
		case "P0001":
			return apperrors.New(apperrors.CodeFailedPrecondition, pgError.Message)
		case "42501":
			return apperrors.New(apperrors.CodeForbidden, "authorization denied")
		case "22023":
			return invalid(pgError.Message)
		}
	}
	return err
}
