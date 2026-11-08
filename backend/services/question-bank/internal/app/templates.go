package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"

	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
)

// Function-only questions (ADR-0063). Per language, an author writes the stub students see
// (Starter) and the code around their function (Prefix before it, Suffix after it: the includes,
// the input reading, the call and the printing). Students write the function; their code runs as
// Prefix + their code + Suffix. Prefix and Suffix never reach a student.

type CodeTemplate struct {
	Starter string `json:"starter"`
	Prefix  string `json:"prefix"`
	Suffix  string `json:"suffix"`
}

type CodeTemplates map[string]CodeTemplate

const (
	maxStarterBytes  = 8 << 10
	maxWrapperBytes  = 16 << 10
	maxTemplateLangs = 16
)

var languageKey = regexp.MustCompile(`^[a-z0-9+#-]{1,24}$`)

func templateObjectKey(versionID string) string {
	return "qbank/templates/" + strings.ToLower(versionID) + ".json"
}

// Compose is what the judge runs for a student's function.
func (template CodeTemplate) Compose(source string) string {
	return template.Prefix + source + template.Suffix
}

func (templates CodeTemplates) validate() error {
	if len(templates) > maxTemplateLangs {
		return apperrors.New(apperrors.CodeInvalidArgument, "too many languages")
	}
	for language, template := range templates {
		if !languageKey.MatchString(language) {
			return apperrors.New(apperrors.CodeInvalidArgument, fmt.Sprintf("%q is not a language", language))
		}
		if len(template.Starter) > maxStarterBytes || len(template.Prefix) > maxWrapperBytes || len(template.Suffix) > maxWrapperBytes {
			return apperrors.New(apperrors.CodeInvalidArgument, "a stub is at most 8 KB and its wrapper at most 16 KB")
		}
	}
	return nil
}

// loadTemplates reads a version's templates; a version without any has none.
func (service *Service) loadTemplates(contextValue context.Context, versionID string) (CodeTemplates, error) {
	key := templateObjectKey(versionID)
	exists, err := service.storage.Exists(contextValue, key)
	if err != nil {
		return nil, fmt.Errorf("check templates: %w", err)
	}
	if !exists {
		return CodeTemplates{}, nil
	}
	object, _, err := service.storage.Get(contextValue, key)
	if err != nil {
		return nil, fmt.Errorf("read templates: %w", err)
	}
	defer func() { _ = object.Close() }()
	raw, err := io.ReadAll(io.LimitReader(object, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read templates: %w", err)
	}
	templates := CodeTemplates{}
	if err := json.Unmarshal(raw, &templates); err != nil {
		return nil, fmt.Errorf("decode templates: %w", err)
	}
	return templates, nil
}

// GetTemplates is the author's view of a version's stubs and wrappers.
func (service *Service) GetTemplates(contextValue context.Context, capability centralauthz.Capability, versionID string) (CodeTemplates, error) {
	if _, err := service.GetQuestionVersion(contextValue, capability, versionID); err != nil {
		return nil, err
	}
	return service.loadTemplates(contextValue, versionID)
}

// SetTemplates replaces a draft's templates. A published version is immutable (ADR-0053).
func (service *Service) SetTemplates(contextValue context.Context, capability centralauthz.Capability, versionID string, templates CodeTemplates) error {
	if err := templates.validate(); err != nil {
		return err
	}
	version, err := service.GetQuestionVersion(contextValue, capability, versionID)
	if err != nil {
		return err
	}
	if version.Status != "draft" {
		return apperrors.New(apperrors.CodeConflict, "only a draft's stubs can be changed")
	}
	if len(templates) == 0 {
		return service.storage.Delete(contextValue, templateObjectKey(versionID))
	}
	raw, err := json.Marshal(templates)
	if err != nil {
		return err
	}
	if len(raw) > 1<<20 {
		return apperrors.New(apperrors.CodeInvalidArgument, "templates payload exceeds 1 MiB limit")
	}
	return service.storage.Put(contextValue, templateObjectKey(versionID), bytes.NewReader(raw), int64(len(raw)), "application/json")
}

// starters are the stubs alone: all a student is shown.
func (templates CodeTemplates) starters() map[string]string {
	starters := map[string]string{}
	for language, template := range templates {
		if strings.TrimSpace(template.Starter) != "" {
			starters[language] = template.Starter
		}
	}
	return starters
}

// composeFor wraps source for the language when the version has a wrapper for it; otherwise it is returned as is.
func (service *Service) composeFor(contextValue context.Context, versionID, language, source string) (string, bool, error) {
	templates, err := service.loadTemplates(contextValue, versionID)
	if err != nil {
		return "", false, err
	}
	template, found := templates[language]
	if !found || (template.Prefix == "" && template.Suffix == "") {
		return source, false, nil
	}
	return template.Compose(source), true, nil
}
