package app

import (
	"context"
	"encoding/json"
	"strings"
	"unicode"

	"github.com/jackc/pgx/v5"
	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/database"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
)

// CategoryRef is the category a question is filed under (ADR-0052).
type CategoryRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// UncategorisedID is the built-in category that holds every question written before
// categories existed, and whatever a deleted category's questions move to.
const UncategorisedID = "018f4b0d-08f8-7c09-9ba7-efdf9c220c01"

const maximumCategoryName = 80

// NormalizeCategoryName collapses runs of whitespace and rejects names the
// database would. The database checks again; this gives the author the reason.
func NormalizeCategoryName(name string) (string, error) {
	cleaned := strings.Join(strings.Fields(name), " ")
	if cleaned == "" || len([]rune(cleaned)) > maximumCategoryName {
		return "", apperrors.New(apperrors.CodeInvalidArgument, "a category name has 1 to 80 characters")
	}
	for _, character := range cleaned {
		if unicode.IsControl(character) {
			return "", apperrors.New(apperrors.CodeInvalidArgument, "a category name cannot contain control characters")
		}
	}
	return cleaned, nil
}

// CreateCategory adds a category; ParentID files it as a sub-category (ADR-0058).
type CreateCategory struct {
	ID       string
	Name     string
	ParentID string
}

// UpdateCategory renames a category, moves it, or both in one transaction. A nil Name keeps the name;
// MoveTo false keeps the parent, and an empty ParentID then means top level (ADR-0058).
type UpdateCategory struct {
	ID       string
	Name     *string
	MoveTo   bool
	ParentID string
}

// DeleteCategory removes a category. Its questions move to MoveTo, or to Uncategorised.
type DeleteCategory struct {
	ID     string
	MoveTo string
}

type SetQuestionCategory struct {
	QuestionID string
	CategoryID string
}

// SetQuestionTags replaces a question's tags, whatever state its versions are in.
type SetQuestionTags struct {
	QuestionID string
	Tags       []Tag
}

func (service *Service) inTransaction(contextValue context.Context, capability centralauthz.Capability, work func(pgx.Tx) (json.RawMessage, error)) (json.RawMessage, error) {
	var raw json.RawMessage
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		raw, storeErr = work(transaction)
		return storeErr
	})
	return raw, err
}

// ListCategories is every category with the number of live questions in it.
func (service *Service) ListCategories(contextValue context.Context, capability centralauthz.Capability) (json.RawMessage, error) {
	return service.inTransaction(contextValue, capability, func(transaction pgx.Tx) (json.RawMessage, error) {
		return service.store.ListCategories(contextValue, transaction)
	})
}

// CreateCategory adds a category, or returns the existing one with the same name in any letter case.
func (service *Service) CreateCategory(contextValue context.Context, capability centralauthz.Capability, command CreateCategory) (json.RawMessage, error) {
	name, err := NormalizeCategoryName(command.Name)
	if err != nil {
		return nil, err
	}
	if !isUUID(command.ID) || (command.ParentID != "" && !isUUID(command.ParentID)) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "category identifier is invalid")
	}
	return service.inTransaction(contextValue, capability, func(transaction pgx.Tx) (json.RawMessage, error) {
		return service.store.CreateCategory(contextValue, transaction, command.ID, name, command.ParentID)
	})
}

func (service *Service) UpdateCategory(contextValue context.Context, capability centralauthz.Capability, command UpdateCategory) (json.RawMessage, error) {
	if !isUUID(command.ID) || (command.ParentID != "" && !isUUID(command.ParentID)) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "category identifier is invalid")
	}
	name := ""
	if command.Name != nil {
		var err error
		if name, err = NormalizeCategoryName(*command.Name); err != nil {
			return nil, err
		}
	}
	return service.inTransaction(contextValue, capability, func(transaction pgx.Tx) (json.RawMessage, error) {
		var raw json.RawMessage
		var err error
		if command.Name != nil {
			if raw, err = service.store.RenameCategory(contextValue, transaction, command.ID, name); err != nil {
				return nil, err
			}
		}
		if command.MoveTo {
			return service.store.MoveCategory(contextValue, transaction, command.ID, command.ParentID)
		}
		return raw, nil
	})
}

func (service *Service) DeleteCategory(contextValue context.Context, capability centralauthz.Capability, command DeleteCategory) (json.RawMessage, error) {
	if !isUUID(command.ID) || (command.MoveTo != "" && !isUUID(command.MoveTo)) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "category identifier is invalid")
	}
	return service.inTransaction(contextValue, capability, func(transaction pgx.Tx) (json.RawMessage, error) {
		return service.store.DeleteCategory(contextValue, transaction, command.ID, command.MoveTo)
	})
}

func (service *Service) SetQuestionCategory(contextValue context.Context, capability centralauthz.Capability, command SetQuestionCategory) (json.RawMessage, error) {
	if !isUUID(command.QuestionID) || !isUUID(command.CategoryID) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "question and category identifiers are required")
	}
	return service.inTransaction(contextValue, capability, func(transaction pgx.Tx) (json.RawMessage, error) {
		return service.store.SetQuestionCategory(contextValue, transaction, command.QuestionID, command.CategoryID)
	})
}

func (service *Service) SetQuestionTags(contextValue context.Context, capability centralauthz.Capability, command SetQuestionTags) (json.RawMessage, error) {
	if !isUUID(command.QuestionID) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "question identifier is invalid")
	}
	if err := normalizeTags(&command.Tags); err != nil {
		return nil, err
	}
	return service.inTransaction(contextValue, capability, func(transaction pgx.Tx) (json.RawMessage, error) {
		return service.store.SetQuestionTags(contextValue, transaction, command.QuestionID, command.Tags)
	})
}

// ListTags is the tags in use, most used first, for suggestions.
func (service *Service) ListTags(contextValue context.Context, capability centralauthz.Capability, limit int) (json.RawMessage, error) {
	if limit < 1 || limit > 500 {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "tag listing limit must be between 1 and 500")
	}
	return service.inTransaction(contextValue, capability, func(transaction pgx.Tx) (json.RawMessage, error) {
		return service.store.ListTags(contextValue, transaction, limit)
	})
}
