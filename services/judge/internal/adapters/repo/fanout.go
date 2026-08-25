package repo

import (
	"bytes"
	"context"
	"fmt"
	"io"

	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/aethercode/aethercode/libs/pkg/kms"
	"github.com/aethercode/aethercode/libs/pkg/storage"
	"github.com/aethercode/aethercode/services/judge/internal/app"
	"github.com/aethercode/aethercode/services/judge/internal/bundle"
	"github.com/jackc/pgx/v5"
)

// maxBundleCiphertextBytes bounds how much of a bundle object fan-out will
// read into memory before decrypting it. bundle.Parse already bounds the
// parsed test-case COUNT (maxTestCases = 500), but that check only runs
// after the whole object has already been read and decrypted -- an
// oversized object would otherwise still cause unbounded memory use on the
// way there. 10 MiB comfortably fits 500 test cases at an average of ~20KiB
// of stdin+expected_output each (generous for typical test-case fixtures),
// with headroom for encryption overhead, while still bounding a malicious or
// accidental oversized upload.
const maxBundleCiphertextBytes = 10 * 1024 * 1024

// unitObjectRef identifies one test case's independently encrypted storage
// object, produced by fanOutTestCases and consumed when inserting
// judge.execution_units rows.
type unitObjectRef struct {
	UnitNumber int
	ObjectKey  string
	KeyRef     string
}

// fanOutTestCases decrypts one evaluation bundle and re-encrypts each test
// case it contains as its own independently stored object, so a single
// leaked ciphertext exposes only one test case rather than the whole bundle.
// jobID scopes the generated object keys so concurrent jobs never collide.
func fanOutTestCases(
	ctx context.Context,
	objectStorage storage.Object,
	keyManager kms.KeyManager,
	bundleObjectKey, bundleKeyRef, jobID string,
) ([]unitObjectRef, error) {
	reader, _, err := objectStorage.Get(ctx, bundleObjectKey)
	if err != nil {
		return nil, fmt.Errorf("fan-out: fetch bundle: %w", err)
	}
	defer func() { _ = reader.Close() }()
	ciphertext, err := io.ReadAll(io.LimitReader(reader, maxBundleCiphertextBytes))
	if err != nil {
		return nil, fmt.Errorf("fan-out: read bundle: %w", err)
	}
	plaintext, err := keyManager.Decrypt(ctx, ciphertext, bundleKeyRef)
	if err != nil {
		return nil, fmt.Errorf("fan-out: decrypt bundle: %w", err)
	}
	testCases, err := bundle.Parse(plaintext)
	if err != nil {
		return nil, fmt.Errorf("fan-out: parse bundle: %w", err)
	}

	refs := make([]unitObjectRef, 0, len(testCases))
	storedKeys := make([]string, 0, len(testCases))
	for i, testCase := range testCases {
		unitPlaintext, err := bundle.MarshalTestCase(testCase)
		if err != nil {
			cleanupOrphanedObjects(ctx, objectStorage, storedKeys)
			return nil, fmt.Errorf("fan-out: encode unit %d: %w", i, err)
		}
		unitCiphertext, keyRef, err := keyManager.Encrypt(ctx, unitPlaintext)
		if err != nil {
			cleanupOrphanedObjects(ctx, objectStorage, storedKeys)
			return nil, fmt.Errorf("fan-out: encrypt unit %d: %w", i, err)
		}
		objectKey := fmt.Sprintf("judge/execution-units/%s/%d", jobID, i)
		if err := objectStorage.Put(ctx, objectKey, bytes.NewReader(unitCiphertext), int64(len(unitCiphertext)), "application/json"); err != nil {
			// Best-effort cleanup: this attempt's earlier Puts already
			// succeeded and are not tracked anywhere else (the job's
			// execution_units rows are only inserted after fanOutTestCases
			// returns), so they would otherwise leak permanently. A cleanup
			// failure must not mask the original Put error, which is what
			// the caller needs to see and act on.
			cleanupOrphanedObjects(ctx, objectStorage, storedKeys)
			return nil, fmt.Errorf("fan-out: store unit %d: %w", i, err)
		}
		storedKeys = append(storedKeys, objectKey)
		refs = append(refs, unitObjectRef{UnitNumber: i, ObjectKey: objectKey, KeyRef: keyRef})
	}
	return refs, nil
}

// cleanupOrphanedObjects best-effort deletes objects already stored during an
// abandoned fan-out attempt. Individual delete failures are intentionally
// ignored: this function only runs while returning a more important error to
// the caller (the original fan-out failure), and there is no established
// error-reporting channel from this package back to an operator to surface a
// secondary cleanup failure through.
func cleanupOrphanedObjects(ctx context.Context, objectStorage storage.Object, keys []string) {
	for _, key := range keys {
		_ = objectStorage.Delete(ctx, key)
	}
}

// fanOutIntoExecutionUnits fans a newly admitted job's evaluation bundle out
// into judge.execution_units, one row per test case, within transaction. A
// job is never left admitted with zero units: any fan-out failure here
// propagates to the caller, which rolls transaction back.
//
// It returns the refs for every object it successfully uploaded, even when
// it later returns an error (e.g. an INSERT after a successful upload
// fails) — the caller uses this to best-effort clean up storage objects
// that were durably written but whose owning transaction did not commit,
// since a storage Put cannot itself be rolled back by the SQL transaction.
func (repository *Postgres) fanOutIntoExecutionUnits(
	contextValue context.Context,
	transaction pgx.Tx,
	jobID string,
	request app.SubmitExecution,
) ([]unitObjectRef, error) {
	if repository.storage == nil || repository.kms == nil {
		return nil, app.ErrFanOutUnavailable
	}
	refs, err := fanOutTestCases(
		contextValue, repository.storage, repository.kms,
		request.EvaluationBundleRef, request.EvaluationBundleKeyRef, jobID,
	)
	if err != nil {
		return nil, err
	}
	for _, ref := range refs {
		unitID, err := database.NewUUIDv7()
		if err != nil {
			return refs, err
		}
		if _, err := transaction.Exec(contextValue, `
			INSERT INTO judge.execution_units (
				id, job_id, unit_number, test_case_ciphertext_ref, encryption_key_reference, state
			) VALUES ($1, $2, $3, $4, $5, 'queued')
		`, unitID, jobID, ref.UnitNumber, ref.ObjectKey, ref.KeyRef); err != nil {
			return refs, fmt.Errorf("insert execution unit %d: %w", ref.UnitNumber, err)
		}
	}
	return refs, nil
}
