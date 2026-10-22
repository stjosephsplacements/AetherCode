//go:build integration

package repo_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

// TestQuestionReview covers ADR-0044's database side: a draft can be sent for
// review, a deployment that requires reviews refuses to publish without one or
// by the person who asked, a different staff member publishes it, and an edit
// after the request makes the approval stale.
func TestQuestionReview(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := newMigratedPool(ctx, t)

	author, reviewer, questionID := uuid.New(), uuid.New(), uuid.New()
	_, err := pool.Exec(ctx, `INSERT INTO qbank.questions (id, slug, created_by) VALUES ($1, 'q', $2)`, questionID, author)
	require.NoError(t, err)
	newVersion := func(number int) uuid.UUID {
		id := uuid.New()
		_, err := pool.Exec(ctx, `
			INSERT INTO qbank.question_versions
			    (id, question_id, version_number, title, prompt_markdown, difficulty,
			     supported_languages, time_limit_ms, memory_limit_kib, created_by,
			     kind, choices, correct_choices)
			VALUES ($1, $2, $3, 'Big O', 'Binary search runs in?', 'easy', '[]'::jsonb, 1000, 65536, $4,
			        'mcq', '["O(n)","O(log n)"]'::jsonb, '{1}')`, id, questionID, number, author)
		require.NoError(t, err)
		return id
	}
	for _, actor := range []uuid.UUID{author, reviewer} {
		_, err = pool.Exec(ctx, `
			INSERT INTO authz.actor_global_authorizations (actor_id, authz_revision, can_read, can_write, active)
			VALUES ($1, 1, true, true, true)`, actor)
		require.NoError(t, err)
	}
	markAuthorizationProjectionReady(ctx, t, pool)

	requestReview := func(actor, version uuid.UUID, expected int64) error {
		return asWriter(ctx, pool, actor, "qbank.question_versions", func(tx pgx.Tx) error {
			var raw []byte
			return tx.QueryRow(ctx, `SELECT qbank.request_question_review($1, $2)`, version, expected).Scan(&raw)
		})
	}
	publish := func(actor, version uuid.UUID, expected int64, requireReview bool) error {
		return asWriter(ctx, pool, actor, "qbank.question_versions", func(tx pgx.Tx) error {
			var raw []byte
			return tx.QueryRow(ctx, `SELECT qbank.publish_question_version($1, $2, $3, $4)`, version, uuid.New(), expected, requireReview).Scan(&raw)
		})
	}

	queue := func() int {
		var count int
		require.NoError(t, asWriter(ctx, pool, reviewer, "qbank.questions", func(tx pgx.Tx) error {
			var raw []byte
			if err := tx.QueryRow(ctx, `SELECT qbank.list_review_queue(50)`).Scan(&raw); err != nil {
				return err
			}
			return tx.QueryRow(ctx, `SELECT jsonb_array_length($1::jsonb)`, raw).Scan(&count)
		}))
		return count
	}
	first := newVersion(1)
	require.Equal(t, 0, queue())
	requirePgCode(t, publish(author, first, 1, true), "55000") // no review requested
	requirePgCode(t, requestReview(author, first, 9), "40001") // stale revision
	require.NoError(t, requestReview(author, first, 1))        // revision is now 2
	requirePgCode(t, publish(author, first, 2, true), "42501") // not by the requester
	require.NoError(t, publish(reviewer, first, 2, true))      // by somebody else
	require.Equal(t, 0, queue(), "a published version leaves the queue")
	requirePgCode(t, requestReview(author, first, 3), "55000") // published versions are final

	second := newVersion(2)
	require.NoError(t, publish(author, second, 1, false), "without the requirement, anyone publishes a draft")

	third := newVersion(3)
	askFor := func(version, reviewerID uuid.UUID) error {
		return asWriter(ctx, pool, author, "qbank.question_versions", func(tx pgx.Tx) error {
			var raw []byte
			return tx.QueryRow(ctx, `SELECT qbank.request_question_review($1, 1, $2)`, version, reviewerID).Scan(&raw)
		})
	}
	requirePgCode(t, askFor(third, author), "22023") // not yourself
	require.NoError(t, askFor(third, reviewer))
	var assigned uuid.UUID
	require.NoError(t, pool.QueryRow(ctx, `SELECT assigned_reviewer_id FROM qbank.question_versions WHERE id = $1`, third).Scan(&assigned))
	require.Equal(t, reviewer, assigned)
	_, err = pool.Exec(ctx, `UPDATE qbank.question_versions SET version = version + 1 WHERE id = $1`, third) // an edit after the request
	require.NoError(t, err)
	requirePgCode(t, publish(reviewer, third, 2, true), "40001")

	var requestedBy uuid.UUID
	require.NoError(t, pool.QueryRow(ctx, `SELECT review_requested_by FROM qbank.question_versions WHERE id = $1`, third).Scan(&requestedBy))
	require.Equal(t, author, requestedBy)
}
