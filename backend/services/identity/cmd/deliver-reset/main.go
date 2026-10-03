// Command deliver-reset is the operator's out-of-band delivery path for a
// password reset when no email channel exists. After someone requests a reset
// for an email (POST /v1/auth/password-reset), it finds that principal's newest
// unconsumed, unexpired reset request and prints the bearer that request
// stands for, derived with the identity delivery-token key. The bearer then
// completes the reset through POST /v1/auth/password-reset/complete.
//
// It never creates, changes or reveals a password, and it prints nothing
// unless a live reset request already exists.
package main

import (
	"context"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/aethercode/aethercode/services/identity/internal/domain"
	"github.com/jackc/pgx/v5"
)

func run(ctx context.Context, databaseURL, encodedKey, email string) (string, error) {
	email = strings.TrimSpace(email)
	if email == "" {
		return "", errors.New("email is required")
	}
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encodedKey))
	if err != nil {
		return "", fmt.Errorf("decode delivery-token key: %w", err)
	}
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return "", fmt.Errorf("connect to identity database: %w", err)
	}
	defer func() { _ = conn.Close(ctx) }()

	var tokenID string
	err = conn.QueryRow(ctx, `
		SELECT t.id::text
		FROM identity.password_reset_tokens t
		JOIN identity.principals p ON p.id = t.principal_id
		WHERE lower(p.email) = lower($1)
		  AND p.deleted_at IS NULL
		  AND t.consumed_at IS NULL
		  AND t.expires_at > clock_timestamp()
		ORDER BY t.issued_at DESC
		LIMIT 1`, email).Scan(&tokenID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("no live password-reset request for %s; request one first", email)
	}
	if err != nil {
		return "", fmt.Errorf("find reset request: %w", err)
	}
	return domain.DeriveDeliveryToken(key, "password-reset", tokenID)
}

func main() {
	var email string
	flag.StringVar(&email, "email", "", "Email address the reset was requested for")
	flag.Parse()

	databaseURL := os.Getenv("IDENTITY_DATABASE_URL")
	encodedKey := os.Getenv("IDENTITY_DELIVERY_TOKEN_HMAC_KEY_BASE64")
	if databaseURL == "" || encodedKey == "" {
		fmt.Fprintln(os.Stderr, "IDENTITY_DATABASE_URL and IDENTITY_DELIVERY_TOKEN_HMAC_KEY_BASE64 are required")
		os.Exit(2)
	}
	token, err := run(context.Background(), databaseURL, encodedKey, email)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(token)
}
