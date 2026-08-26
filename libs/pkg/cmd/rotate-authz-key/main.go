// Command rotate-authz-key publishes or retires one row of a single target
// database's authz.context_keys table. It operationalizes the zero-downtime
// rotation window that authz.set_context already supports (not_before /
// not_after / retired_at) without any change to libs/pkg/authz.
//
// A publish generates fresh HMAC key material with crypto/rand and prints it
// to stderr exactly once; it is never written to a file, a log, or stdout.
// The operator must copy it out-of-band into the signing service's
// AUTHZ_CAPABILITY_KEYS configuration. A retire marks an existing key
// permanently invalid by setting retired_at.
package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"flag"
	"fmt"
	"os"
	"regexp"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/jackc/pgx/v5"
)

// audiencePattern mirrors authz.SigningKey's unexported validation regex and
// the authz.context_keys audience CHECK constraint.
var audiencePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,62}$`)

const keyMaterialBytes = 32

func validateArguments(action, audience string) error {
	if action != "publish" && action != "retire" {
		return fmt.Errorf("action must be %q or %q", "publish", "retire")
	}
	if !audiencePattern.MatchString(audience) {
		return fmt.Errorf("audience %q is invalid", audience)
	}
	return nil
}

// requireAudienceMatchesDatabase confirms --audience actually names the
// database --database-url connects to, mirroring the guard
// scripts/provision-authz-context-key runs before its INSERT. Without this,
// authz.set_context's `WHERE key.audience = current_database()` lookup means
// a key published under a mistyped or wrong audience inserts successfully
// but can never be selected by any service, and the mismatch is only
// discovered at cutover time.
func requireAudienceMatchesDatabase(ctx context.Context, conn *pgx.Conn, audience string) error {
	var currentDatabase string
	if err := conn.QueryRow(ctx, "SELECT current_database()").Scan(&currentDatabase); err != nil {
		return fmt.Errorf("determine connected database: %w", err)
	}
	if currentDatabase != audience {
		return fmt.Errorf("audience %q does not match the connected database %q", audience, currentDatabase)
	}
	return nil
}

func publish(ctx context.Context, conn *pgx.Conn, audience, keyID string, notBefore, notAfter time.Time) error {
	var err error
	if keyID == "" {
		keyID, err = database.NewUUIDv7()
		if err != nil {
			return fmt.Errorf("generate key ID: %w", err)
		}
	}

	if err := requireAudienceMatchesDatabase(ctx, conn, audience); err != nil {
		return err
	}

	secret := make([]byte, keyMaterialBytes)
	if _, err := rand.Read(secret); err != nil {
		return fmt.Errorf("read key material randomness: %w", err)
	}

	_, err = conn.Exec(ctx,
		"INSERT INTO authz.context_keys (key_id, audience, key_material, not_before, not_after) VALUES ($1, $2, $3, $4, $5)",
		keyID, audience, secret, notBefore, notAfter,
	)
	if err != nil {
		return fmt.Errorf("insert authorization context key: %w", err)
	}

	fmt.Fprintln(os.Stderr, "=== ONE-TIME SECRET DISPLAY: copy this now, it will never be shown again ===")
	fmt.Fprintf(os.Stderr, "key_id:        %s\n", keyID)
	fmt.Fprintf(os.Stderr, "audience:      %s\n", audience)
	fmt.Fprintf(os.Stderr, "secret_base64: %s\n", base64.StdEncoding.EncodeToString(secret))
	fmt.Fprintln(os.Stderr, "Place secret_base64 into the signing service's AUTHZ_CAPABILITY_KEYS")
	fmt.Fprintln(os.Stderr, "configuration out-of-band. It is not written to any file or log by this tool.")
	return nil
}

func retire(ctx context.Context, conn *pgx.Conn, audience, keyID string) error {
	if keyID == "" {
		return fmt.Errorf("key-id is required for retire")
	}
	tag, err := conn.Exec(ctx,
		"UPDATE authz.context_keys SET retired_at = clock_timestamp() WHERE key_id = $1 AND audience = $2 AND retired_at IS NULL",
		keyID, audience,
	)
	if err != nil {
		return fmt.Errorf("retire authorization context key: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("no active key %s found for audience %q (already retired or does not exist)", keyID, audience)
	}
	return nil
}

func run(ctx context.Context, action, audience, databaseURL, keyID string, notBefore, notAfter time.Time) error {
	if err := validateArguments(action, audience); err != nil {
		return err
	}
	if action == "publish" && notAfter.IsZero() {
		return fmt.Errorf("not-after is required for publish")
	}

	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("connect to target database: %w", err)
	}
	defer func() { _ = conn.Close(ctx) }()

	switch action {
	case "publish":
		return publish(ctx, conn, audience, keyID, notBefore, notAfter)
	case "retire":
		return retire(ctx, conn, audience, keyID)
	default:
		return fmt.Errorf("action must be %q or %q", "publish", "retire")
	}
}

func main() {
	var action string
	var audience string
	var databaseURL string
	var keyID string
	var notBeforeRaw string
	var notAfterRaw string

	flag.StringVar(&action, "action", "", "publish or retire")
	flag.StringVar(&audience, "audience", "", "target database audience (matches the database name)")
	flag.StringVar(&databaseURL, "database-url", "", "PostgreSQL URL for the single target database")
	flag.StringVar(&keyID, "key-id", "", "key UUID (required for retire; optional for publish, generated if omitted)")
	flag.StringVar(&notBeforeRaw, "not-before", "", "RFC3339 start of validity (publish only; defaults to 5 minutes from now)")
	flag.StringVar(&notAfterRaw, "not-after", "", "RFC3339 end of validity (required for publish)")
	flag.Parse()

	if databaseURL == "" {
		fmt.Fprintln(os.Stderr, "database-url is required")
		os.Exit(2)
	}

	notBefore := time.Now().UTC().Add(5 * time.Minute)
	if notBeforeRaw != "" {
		parsed, err := time.Parse(time.RFC3339, notBeforeRaw)
		if err != nil {
			fmt.Fprintf(os.Stderr, "not-before must be RFC3339: %v\n", err)
			os.Exit(2)
		}
		notBefore = parsed
	}

	var notAfter time.Time
	if notAfterRaw != "" {
		parsed, err := time.Parse(time.RFC3339, notAfterRaw)
		if err != nil {
			fmt.Fprintf(os.Stderr, "not-after must be RFC3339: %v\n", err)
			os.Exit(2)
		}
		notAfter = parsed
	}

	if err := run(context.Background(), action, audience, databaseURL, keyID, notBefore, notAfter); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
