// Command bootstrap creates the first platform principal in the identity
// database and the first self-granted super_admin in the user database.
// It is safe to re-run: each database function is idempotent and refuses
// once the platform is already initialised.
//
// The created account has NO password. The operator activates it through
// the standard password-reset flow. No secret is ever written, printed,
// or accepted by this command.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/jackc/pgx/v5"
)

func validateArguments(email, displayName string) error {
	trimmed := strings.TrimSpace(email)
	if len(trimmed) < 3 || len(trimmed) > 320 {
		return fmt.Errorf("email must be between 3 and 320 characters")
	}
	atPos := strings.Index(trimmed, "@")
	if atPos <= 0 {
		return fmt.Errorf("email must contain '@' after at least one character")
	}
	if strings.TrimSpace(displayName) == "" {
		return fmt.Errorf("display name must not be blank")
	}
	return nil
}

func run(ctx context.Context, identityURL, userURL, email, displayName string) error {
	if err := validateArguments(email, displayName); err != nil {
		return err
	}

	principalID, err := database.NewUUIDv7()
	if err != nil {
		return fmt.Errorf("generate principal ID: %w", err)
	}
	assignmentID, err := database.NewUUIDv7()
	if err != nil {
		return fmt.Errorf("generate assignment ID: %w", err)
	}

	identityConn, err := pgx.Connect(ctx, identityURL)
	if err != nil {
		return fmt.Errorf("connect to identity database: %w", err)
	}
	defer identityConn.Close(ctx)

	var returnedPrincipalID string
	err = identityConn.QueryRow(ctx,
		"SELECT identity.bootstrap_first_principal($1::uuid, $2, $3)",
		principalID, email, displayName,
	).Scan(&returnedPrincipalID)
	if err != nil {
		return fmt.Errorf("identity bootstrap: %w", err)
	}

	userConn, err := pgx.Connect(ctx, userURL)
	if err != nil {
		return fmt.Errorf("connect to user database: %w", err)
	}
	defer userConn.Close(ctx)

	var returnedAssignmentID string
	err = userConn.QueryRow(ctx,
		"SELECT users.bootstrap_first_superadmin($1::uuid, $2::uuid)",
		assignmentID, returnedPrincipalID,
	).Scan(&returnedAssignmentID)
	if err != nil {
		return fmt.Errorf("user bootstrap: %w", err)
	}

	fmt.Printf("Bootstrap complete.\n")
	fmt.Printf("Principal ID: %s\n", returnedPrincipalID)
	fmt.Printf("\nIMPORTANT: This account has no password.\n")
	fmt.Printf("Activate it by triggering the password-reset flow for %s.\n", strings.TrimSpace(email))
	return nil
}

func main() {
	var identityURL string
	var userURL string
	var email string
	var displayName string

	flag.StringVar(&identityURL, "identity-database-url", "", "PostgreSQL URL for the identity database")
	flag.StringVar(&userURL, "user-database-url", "", "PostgreSQL URL for the user database")
	flag.StringVar(&email, "email", "", "Email address for the first platform administrator")
	flag.StringVar(&displayName, "display-name", "", "Display name for the first platform administrator")
	flag.Parse()

	if identityURL == "" || userURL == "" || email == "" || displayName == "" {
		fmt.Fprintln(os.Stderr, "identity-database-url, user-database-url, email, and display-name are required")
		os.Exit(2)
	}

	if err := run(context.Background(), identityURL, userURL, email, displayName); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
