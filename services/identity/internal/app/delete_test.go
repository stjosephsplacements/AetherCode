package app

import (
	"context"
	"errors"
	"testing"
	"time"
)

type mockStore struct {
	getPrincipalFunc               func(context.Context, string) (*Principal, error)
	getPrincipalIncludeDeletedFunc func(context.Context, string) (*Principal, error)
	softDeletePrincipalFunc        func(context.Context, DeletePrincipal) error
	hardDeletePrincipalFunc        func(context.Context, DeletePrincipal) error
}

func (m *mockStore) Register(context.Context, Registration) error         { return nil }
func (m *mockStore) VerifyEmail(context.Context, []byte) (string, error)  { return "", nil }
func (m *mockStore) Authenticate(context.Context, Login) (Session, error) { return Session{}, nil }
func (m *mockStore) RotateRefresh(context.Context, RefreshRotation) (Session, error) {
	return Session{}, nil
}
func (m *mockStore) RevokeRefresh(context.Context, []byte, string) error              { return nil }
func (m *mockStore) RequestPasswordReset(context.Context, PasswordResetRequest) error { return nil }
func (m *mockStore) ResetPassword(context.Context, PasswordReset) error               { return nil }
func (m *mockStore) ValidateAccessToken(context.Context, string, string) error        { return nil }
func (m *mockStore) CreateMFAChallenge(context.Context, MFAChallenge) error           { return nil }
func (m *mockStore) CompleteMFAChallenge(context.Context, MFAChallengeCompletion) (Session, error) {
	return Session{}, nil
}
func (m *mockStore) BeginTOTP(context.Context, TOTPEnrollment) error                { return nil }
func (m *mockStore) ActivateTOTP(context.Context, TOTPActivation) ([]string, error) { return nil, nil }
func (m *mockStore) DisableTOTP(context.Context, TOTPDisable) error                 { return nil }
func (m *mockStore) Ping(context.Context) error                                     { return nil }

func (m *mockStore) GetPrincipal(ctx context.Context, id string) (*Principal, error) {
	if m.getPrincipalFunc != nil {
		return m.getPrincipalFunc(ctx, id)
	}
	return nil, errors.New("not implemented")
}

func (m *mockStore) GetPrincipalIncludeDeleted(ctx context.Context, id string) (*Principal, error) {
	if m.getPrincipalIncludeDeletedFunc != nil {
		return m.getPrincipalIncludeDeletedFunc(ctx, id)
	}
	return nil, errors.New("not implemented")
}

func (m *mockStore) SoftDeletePrincipal(ctx context.Context, cmd DeletePrincipal) error {
	if m.softDeletePrincipalFunc != nil {
		return m.softDeletePrincipalFunc(ctx, cmd)
	}
	return nil
}

func (m *mockStore) HardDeletePrincipal(ctx context.Context, cmd DeletePrincipal) error {
	if m.hardDeletePrincipalFunc != nil {
		return m.hardDeletePrincipalFunc(ctx, cmd)
	}
	return nil
}

func TestService_DeletePrincipal(t *testing.T) {
	ctx := context.Background()
	principalID := "550e8400-e29b-41d4-a716-446655440000"
	actorID := "550e8400-e29b-41d4-a716-446655440001"

	t.Run("successful soft delete", func(t *testing.T) {
		store := &mockStore{
			getPrincipalFunc: func(ctx context.Context, id string) (*Principal, error) {
				return &Principal{
					ID:          id,
					Email:       "test@example.com",
					DisplayName: "Test User",
					Status:      "active",
					CreatedAt:   time.Now(),
					UpdatedAt:   time.Now(),
				}, nil
			},
			softDeletePrincipalFunc: func(ctx context.Context, cmd DeletePrincipal) error {
				if cmd.ID != principalID {
					t.Errorf("expected ID %s, got %s", principalID, cmd.ID)
				}
				if cmd.ActorID != actorID {
					t.Errorf("expected ActorID %s, got %s", actorID, cmd.ActorID)
				}
				if cmd.Reason != "Test deletion" {
					t.Errorf("expected reason 'Test deletion', got %s", cmd.Reason)
				}
				return nil
			},
		}

		service := &Service{store: store}

		command := DeletePrincipal{
			ID:      principalID,
			ActorID: actorID,
			Reason:  "Test deletion",
		}

		err := service.DeletePrincipal(ctx, command)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
	})

	t.Run("requires deletion reason", func(t *testing.T) {
		store := &mockStore{}
		service := &Service{store: store}

		command := DeletePrincipal{
			ID:      principalID,
			ActorID: actorID,
			Reason:  "",
		}

		err := service.DeletePrincipal(ctx, command)
		if err == nil {
			t.Error("expected error for missing deletion reason")
		}
	})

	t.Run("validates UUID format", func(t *testing.T) {
		store := &mockStore{}
		service := &Service{store: store}

		command := DeletePrincipal{
			ID:      "invalid-uuid",
			ActorID: actorID,
			Reason:  "Test",
		}

		err := service.DeletePrincipal(ctx, command)
		if err == nil {
			t.Error("expected error for invalid UUID")
		}
	})

	t.Run("verifies principal exists", func(t *testing.T) {
		store := &mockStore{
			getPrincipalFunc: func(ctx context.Context, id string) (*Principal, error) {
				return nil, errors.New("principal not found")
			},
		}
		service := &Service{store: store}

		command := DeletePrincipal{
			ID:      principalID,
			ActorID: actorID,
			Reason:  "Test deletion",
		}

		err := service.DeletePrincipal(ctx, command)
		if err == nil {
			t.Error("expected error when principal not found")
		}
	})
}

func TestService_HardDeletePrincipal(t *testing.T) {
	ctx := context.Background()
	principalID := "550e8400-e29b-41d4-a716-446655440000"
	actorID := "550e8400-e29b-41d4-a716-446655440001"

	t.Run("successful hard delete with SuperAdmin", func(t *testing.T) {
		store := &mockStore{
			getPrincipalIncludeDeletedFunc: func(ctx context.Context, id string) (*Principal, error) {
				deletedAt := time.Now()
				return &Principal{
					ID:          id,
					Email:       "test@example.com",
					DisplayName: "Test User",
					Status:      "active",
					DeletedAt:   &deletedAt,
					CreatedAt:   time.Now(),
					UpdatedAt:   time.Now(),
				}, nil
			},
			hardDeletePrincipalFunc: func(ctx context.Context, cmd DeletePrincipal) error {
				return nil
			},
		}

		service := &Service{store: store}

		command := DeletePrincipal{
			ID:      principalID,
			ActorID: actorID,
			Reason:  "Permanent deletion",
		}

		err := service.HardDeletePrincipal(ctx, command)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
	})

	// Role authorization (super_admin check) is enforced by the Casbin service
	// via AuthorizeHTTP(action="delete"), not by the service layer.

	t.Run("requires deletion reason", func(t *testing.T) {
		store := &mockStore{}
		service := &Service{store: store}

		command := DeletePrincipal{
			ID:      principalID,
			ActorID: actorID,
			Reason:  "",
		}

		err := service.HardDeletePrincipal(ctx, command)
		if err == nil {
			t.Error("expected error for missing deletion reason")
		}
	})

	t.Run("validates UUID format", func(t *testing.T) {
		store := &mockStore{}
		service := &Service{store: store}

		command := DeletePrincipal{
			ID:      "invalid-uuid",
			ActorID: actorID,
			Reason:  "Test",
		}

		err := service.HardDeletePrincipal(ctx, command)
		if err == nil {
			t.Error("expected error for invalid UUID")
		}
	})

	t.Run("verifies principal exists", func(t *testing.T) {
		store := &mockStore{
			getPrincipalIncludeDeletedFunc: func(ctx context.Context, id string) (*Principal, error) {
				return nil, errors.New("principal not found")
			},
		}
		service := &Service{store: store}

		command := DeletePrincipal{
			ID:      principalID,
			ActorID: actorID,
			Reason:  "Permanent deletion",
		}

		err := service.HardDeletePrincipal(ctx, command)
		if err == nil {
			t.Error("expected error when principal not found")
		}
	})
}
