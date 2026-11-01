package repo

import (
	"context"
	"encoding/json"

	"github.com/aethercode/aethercode/services/question-bank/internal/app"
	"github.com/jackc/pgx/v5"
)

// nullableUUID is NULL for an empty identifier, so the database applies its default.
func nullableUUID(id string) any {
	if id == "" {
		return nil
	}
	return id
}

func queryJSON(contextValue context.Context, transaction pgx.Tx, operation, statement string, arguments ...any) (json.RawMessage, error) {
	var raw json.RawMessage
	if err := transaction.QueryRow(contextValue, statement, arguments...).Scan(&raw); err != nil {
		return nil, mapCommandError(err, operation)
	}
	return raw, nil
}

func (repository *Postgres) ListCategories(contextValue context.Context, transaction pgx.Tx) (json.RawMessage, error) {
	return queryJSON(contextValue, transaction, "list categories", `SELECT qbank.list_categories()`)
}

func (repository *Postgres) CreateCategory(contextValue context.Context, transaction pgx.Tx, id, name string) (json.RawMessage, error) {
	return queryJSON(contextValue, transaction, "create category", `SELECT qbank.create_category($1, $2)`, id, name)
}

func (repository *Postgres) RenameCategory(contextValue context.Context, transaction pgx.Tx, id, name string) (json.RawMessage, error) {
	return queryJSON(contextValue, transaction, "rename category", `SELECT qbank.rename_category($1, $2)`, id, name)
}

func (repository *Postgres) DeleteCategory(contextValue context.Context, transaction pgx.Tx, id, moveTo string) (json.RawMessage, error) {
	return queryJSON(contextValue, transaction, "delete category", `SELECT qbank.delete_category($1, $2)`, id, nullableUUID(moveTo))
}

func (repository *Postgres) SetQuestionCategory(contextValue context.Context, transaction pgx.Tx, questionID, categoryID string) (json.RawMessage, error) {
	return queryJSON(contextValue, transaction, "set question category", `SELECT qbank.set_question_category($1, $2)`, questionID, categoryID)
}

func (repository *Postgres) SetQuestionTags(contextValue context.Context, transaction pgx.Tx, questionID string, tags []app.Tag) (json.RawMessage, error) {
	encoded, err := json.Marshal(tags)
	if err != nil {
		return nil, err
	}
	return queryJSON(contextValue, transaction, "set question tags", `SELECT qbank.set_question_tags($1, $2::jsonb)`, questionID, string(encoded))
}

func (repository *Postgres) ListTags(contextValue context.Context, transaction pgx.Tx, limit int) (json.RawMessage, error) {
	return queryJSON(contextValue, transaction, "list tags", `SELECT qbank.list_tags($1)`, limit)
}
