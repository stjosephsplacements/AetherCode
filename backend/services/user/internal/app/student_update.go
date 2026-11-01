package app

import (
	"context"
	"strings"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/jackc/pgx/v5"
)

// UpdateStudent changes a student's enrolment number or admission date. A nil
// field is left as it is. Status moves through the account status route, and a
// batch move through the batch affiliation route, so neither is repeated here.
type UpdateStudent struct {
	ID               string
	EnrollmentNumber *string
	// AdmittedAt is a date, YYYY-MM-DD. An empty string clears it.
	AdmittedAt *string
}

func (service *ManagementService) UpdateStudent(contextValue context.Context, capability centralauthz.Capability, command UpdateStudent) (Student, error) {
	if command.EnrollmentNumber != nil {
		number := strings.TrimSpace(*command.EnrollmentNumber)
		command.EnrollmentNumber = &number
		if len([]rune(number)) < 1 || len([]rune(number)) > 128 {
			return Student{}, apperrors.New(apperrors.CodeInvalidArgument, "the enrolment number needs 1 to 128 characters")
		}
	}
	if command.AdmittedAt != nil && *command.AdmittedAt != "" {
		if _, err := time.Parse(time.DateOnly, *command.AdmittedAt); err != nil {
			return Student{}, apperrors.New(apperrors.CodeInvalidArgument, "the admission date is YYYY-MM-DD")
		}
	}
	if !isUUID(command.ID) || (command.EnrollmentNumber == nil && command.AdmittedAt == nil) {
		return Student{}, apperrors.New(apperrors.CodeInvalidArgument, "give a student and an enrolment number or admission date to change")
	}
	var result Student
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.UpdateStudent(contextValue, transaction, command)
		return err
	})
	return result, err
}
