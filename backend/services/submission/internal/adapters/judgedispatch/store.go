package judgedispatch

import (
	"context"
	"fmt"

	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store uses the dedicated adapter pool. The database role has EXECUTE-only
// access to the claim and mark routines and cannot select candidate records or
// write any table directly.
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) (*Store, error) {
	if pool == nil {
		return nil, fmt.Errorf("judge dispatch adapter database pool is required")
	}
	return &Store{pool: pool}, nil
}

func (store *Store) Ping(contextValue context.Context) error {
	if err := store.pool.Ping(contextValue); err != nil {
		return fmt.Errorf("ping Judge dispatch adapter database: %w", err)
	}
	return nil
}

// Claim leases up to limit queued evaluation requests and up to limit queued
// runs. Rows that are neither marked dispatched nor failed become claimable
// again once their lease lapses, with a longer lease each time.
func (store *Store) Claim(contextValue context.Context, limit, leaseSeconds uint32) ([]Claim, error) {
	evaluations, err := store.claim(contextValue, KindEvaluation, `
		SELECT evaluation_request_id, tenant_id, evaluation_bundle_object_key, evaluation_bundle_checksum,
		       evaluation_bundle_key_reference, source_object_key, source_checksum, source_key_reference,
		       language_id, time_limit_ms, memory_limit_kib, expires_at
		FROM submission.claim_evaluation_requests($1, $2)
	`, limit, leaseSeconds)
	if err != nil {
		return nil, err
	}
	runs, err := store.claim(contextValue, KindRun, `
		SELECT code_run_id, tenant_id, sample_bundle_object_key, sample_bundle_checksum,
		       sample_bundle_key_reference, source_object_key, source_checksum, source_key_reference,
		       language_id, time_limit_ms, memory_limit_kib, expires_at
		FROM submission.claim_code_runs($1, $2)
	`, limit, leaseSeconds)
	if err != nil {
		return nil, err
	}
	return append(evaluations, runs...), nil
}

func (store *Store) claim(contextValue context.Context, kind Kind, query string, limit, leaseSeconds uint32) ([]Claim, error) {
	rows, err := store.pool.Query(contextValue, query, int32(limit), int32(leaseSeconds))
	if err != nil {
		return nil, fmt.Errorf("claim %ss: %w", kind, err)
	}
	defer rows.Close()
	claims := make([]Claim, 0, limit)
	for rows.Next() {
		claim := Claim{Kind: kind}
		if err := rows.Scan(
			&claim.ID, &claim.TenantID, &claim.BundleObjectKey, &claim.BundleChecksum,
			&claim.BundleKeyReference, &claim.SourceObjectKey, &claim.SourceChecksum, &claim.SourceKeyReference,
			&claim.LanguageID, &claim.TimeLimitMS, &claim.MemoryLimitKiB, &claim.ExpiresAt,
		); err != nil {
			return nil, fmt.Errorf("scan claimed %s: %w", kind, err)
		}
		claims = append(claims, claim)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate claimed %ss: %w", kind, err)
	}
	return claims, nil
}

// MarkDispatched records the job Judge accepted.
func (store *Store) MarkDispatched(contextValue context.Context, claim Claim, judgeJobID string) error {
	if claim.Kind == KindRun {
		if _, err := store.pool.Exec(contextValue, `
			SELECT submission.mark_code_run_dispatched($1, $2, $3)
		`, claim.TenantID, claim.ID, judgeJobID); err != nil {
			return fmt.Errorf("mark code run dispatched: %w", err)
		}
		return nil
	}
	if _, err := store.pool.Exec(contextValue, `
		SELECT submission.mark_evaluation_dispatched($1, $2, $3)
	`, claim.TenantID, claim.ID, judgeJobID); err != nil {
		return fmt.Errorf("mark evaluation request dispatched: %w", err)
	}
	return nil
}

// MarkFailed fails a request that can never be graded. Failing the last open
// request of an attempt also grades the attempt, which needs fresh identifiers
// for the events that records.
func (store *Store) MarkFailed(contextValue context.Context, claim Claim, failureCode string) error {
	if claim.Kind == KindRun {
		if _, err := store.pool.Exec(contextValue, `
			SELECT submission.mark_code_run_failed($1, $2, $3)
		`, claim.TenantID, claim.ID, failureCode); err != nil {
			return fmt.Errorf("mark code run failed: %w", err)
		}
		return nil
	}
	var ids [3]string
	for index := range ids {
		id, err := database.NewUUIDv7()
		if err != nil {
			return err
		}
		ids[index] = id
	}
	if _, err := store.pool.Exec(contextValue, `
		SELECT submission.mark_evaluation_failed($1, $2, $3, $4, $5, $6)
	`, claim.TenantID, claim.ID, failureCode, ids[0], ids[1], ids[2]); err != nil {
		return fmt.Errorf("mark evaluation request failed: %w", err)
	}
	return nil
}
