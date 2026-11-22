package repo

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
)

func (repository *Postgres) ListCollegeContests(ctx context.Context, tx pgx.Tx, tenantID string) (json.RawMessage, error) {
	var raw json.RawMessage
	err := tx.QueryRow(ctx, `SELECT qbank.list_college_contests($1)`, tenantID).Scan(&raw)
	return raw, err
}

func (repository *Postgres) SaveCollegeContest(ctx context.Context, tx pgx.Tx, tenantID, id, title, description string, startsAt, endsAt time.Time, questionIDs []string) (json.RawMessage, error) {
	var raw json.RawMessage
	err := tx.QueryRow(ctx, `SELECT qbank.save_college_contest($1, $2, $3, $4, $5, $6, $7::uuid[])`,
		tenantID, id, title, description, startsAt, endsAt, questionIDs).Scan(&raw)
	return raw, err
}

func (repository *Postgres) RegisterCollegeContest(ctx context.Context, tx pgx.Tx, tenantID, contestID string) (json.RawMessage, error) {
	var raw json.RawMessage
	err := tx.QueryRow(ctx, `SELECT qbank.register_college_contest($1, $2)`, tenantID, contestID).Scan(&raw)
	return raw, err
}

func (repository *Postgres) CollegeContestLeaderboard(ctx context.Context, tx pgx.Tx, tenantID, contestID string) (json.RawMessage, error) {
	var raw json.RawMessage
	err := tx.QueryRow(ctx, `SELECT qbank.college_contest_leaderboard($1, $2)`, tenantID, contestID).Scan(&raw)
	return raw, err
}
