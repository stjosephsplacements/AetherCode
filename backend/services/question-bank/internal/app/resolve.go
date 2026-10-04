package app

import (
	"context"
	"fmt"
	"strings"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
)

// PublishedVersionStore reads a published version's pinned artifacts for the
// internal service contract. It runs without a request capability: its only
// callers are mTLS-authenticated services.
type PublishedVersionStore interface {
	ResolvePublishedQuestionVersion(context.Context, string) (ResolvedQuestionVersion, error)
}

// ResolvedQuestionVersion is what an exam item pins: limits and the encrypted
// evaluation and sample bundles. It never carries test content.
type ResolvedQuestionVersion struct {
	QuestionID         string
	QuestionVersionID  string
	VersionNumber      int
	Title              string
	SupportedLanguages []string
	TimeLimitMS        int
	MemoryLimitKiB     int
	Evaluation         ResolvedBundle
	Sample             ResolvedBundle
}

type ResolvedBundle struct {
	ObjectKey     string
	SHA256        string
	KeyReference  string
	TestCaseCount int
}

// Resolver serves QuestionBankInternalService.
type Resolver struct {
	store PublishedVersionStore
}

func NewResolver(store PublishedVersionStore) (*Resolver, error) {
	if store == nil {
		return nil, fmt.Errorf("published version store is required")
	}
	return &Resolver{store: store}, nil
}

// ResolvePublishedQuestionVersion returns not_found for anything other than a
// published version of a live question, so callers cannot probe drafts.
func (resolver *Resolver) ResolvePublishedQuestionVersion(contextValue context.Context, questionVersionID string) (ResolvedQuestionVersion, error) {
	questionVersionID = strings.ToLower(strings.TrimSpace(questionVersionID))
	if !isUUID(questionVersionID) {
		return ResolvedQuestionVersion{}, apperrors.New(apperrors.CodeInvalidArgument, "question version ID must be a UUID")
	}
	return resolver.store.ResolvePublishedQuestionVersion(contextValue, questionVersionID)
}
