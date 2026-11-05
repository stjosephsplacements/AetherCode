package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
	"github.com/stjosephsplacements/AetherCode/services/user/internal/app"
)

// UpdateStudent changes the enrolment number or admission date; whatever is left
// out stays. Row-level security decides whether the caller may write this student.
func (repository *Postgres) UpdateStudent(contextValue context.Context, transaction pgx.Tx, command app.UpdateStudent) (app.Student, error) {
	var tenantID string
	err := transaction.QueryRow(contextValue, `
		UPDATE users.students
		SET enrollment_number = COALESCE($2, enrollment_number),
		    admitted_at = CASE WHEN $3::text IS NULL THEN admitted_at WHEN $3::text = '' THEN NULL ELSE $3::date END,
		    version = version + 1, updated_at = clock_timestamp()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING tenant_id::text
	`, command.ID, command.EnrollmentNumber, command.AdmittedAt).Scan(&tenantID)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Student{}, apperrors.New(apperrors.CodeNotFound, "student was not found")
	}
	if err != nil {
		return app.Student{}, mapWriteError(err, "another student in this college already has that enrolment number")
	}
	payload, err := json.Marshal(map[string]string{"student_id": command.ID, "tenant_id": tenantID})
	if err != nil {
		return app.Student{}, fmt.Errorf("encode student update event: %w", err)
	}
	if err := repository.enqueue(contextValue, transaction, "student", command.ID, tenantID, "user.student.updated.v1", payload); err != nil {
		return app.Student{}, err
	}
	return repository.GetStudent(contextValue, transaction, command.ID)
}
