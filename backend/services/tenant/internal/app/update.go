package app

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/database"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
)

// The update commands carry only the fields the caller wants changed; a nil
// field is left as it is. At least one has to be present.

type UpdateTenant struct {
	ID          string
	LegalName   *string
	DisplayName *string
}

type UpdatePlacementOrganization struct {
	ID        string
	LegalName *string
}

type UpdateDepartment struct {
	ID   string
	Code *string
	Name *string
}

type UpdateBatch struct {
	ID           string
	Code         *string
	Name         *string
	AcademicYear *string
}

// trimmed trims a present field in place and reports whether it passes check.
func trimmed(value **string, check func(string) bool) bool {
	if *value == nil {
		return true
	}
	text := strings.TrimSpace(**value)
	*value = &text
	return check(text)
}

func nothingToChange(fields ...*string) bool {
	for _, field := range fields {
		if field != nil {
			return false
		}
	}
	return true
}

func (service *Service) UpdateTenant(contextValue context.Context, capability centralauthz.Capability, command UpdateTenant) (Tenant, error) {
	name := func(value string) bool { return validText(value, 255) }
	if !isUUID(command.ID) || !trimmed(&command.LegalName, name) || !trimmed(&command.DisplayName, name) || nothingToChange(command.LegalName, command.DisplayName) {
		return Tenant{}, apperrors.New(apperrors.CodeInvalidArgument, "give a legal name or a display name, 1 to 255 characters")
	}
	var result Tenant
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.UpdateTenant(contextValue, transaction, command)
		return err
	})
	return result, err
}

func (service *Service) UpdatePlacementOrganization(contextValue context.Context, capability centralauthz.Capability, command UpdatePlacementOrganization) (PlacementOrganization, error) {
	if !isUUID(command.ID) || !trimmed(&command.LegalName, func(value string) bool { return validText(value, 255) }) || nothingToChange(command.LegalName) {
		return PlacementOrganization{}, apperrors.New(apperrors.CodeInvalidArgument, "give a legal name, 1 to 255 characters")
	}
	var result PlacementOrganization
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.UpdatePlacementOrganization(contextValue, transaction, command)
		return err
	})
	return result, err
}

func (service *Service) UpdateDepartment(contextValue context.Context, capability centralauthz.Capability, command UpdateDepartment) (Department, error) {
	if !isUUID(command.ID) || !trimmed(&command.Code, collegeCodePattern.MatchString) || !trimmed(&command.Name, func(value string) bool { return validText(value, 255) }) || nothingToChange(command.Code, command.Name) {
		return Department{}, apperrors.New(apperrors.CodeInvalidArgument, "department code or name is invalid")
	}
	var result Department
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.UpdateDepartment(contextValue, transaction, command)
		return err
	})
	return result, err
}

func (service *Service) UpdateBatch(contextValue context.Context, capability centralauthz.Capability, command UpdateBatch) (Batch, error) {
	if !isUUID(command.ID) || !trimmed(&command.Code, collegeCodePattern.MatchString) || !trimmed(&command.Name, func(value string) bool { return validText(value, 255) }) || !trimmed(&command.AcademicYear, yearPattern.MatchString) || nothingToChange(command.Code, command.Name, command.AcademicYear) {
		return Batch{}, apperrors.New(apperrors.CodeInvalidArgument, "batch code, name or academic year is invalid")
	}
	var result Batch
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.UpdateBatch(contextValue, transaction, command)
		return err
	})
	return result, err
}
