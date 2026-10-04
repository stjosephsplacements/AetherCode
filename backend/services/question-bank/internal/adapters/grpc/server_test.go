package grpcadapter

import (
	"context"
	"errors"
	"testing"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	questionbankv1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/questionbank/v1"
	"github.com/aethercode/aethercode/services/question-bank/internal/app"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type fakeResolver struct {
	resolved app.ResolvedQuestionVersion
	err      error
}

func (resolver fakeResolver) ResolvePublishedQuestionVersion(context.Context, string) (app.ResolvedQuestionVersion, error) {
	return resolver.resolved, resolver.err
}

func TestResolvePublishedQuestionVersionMapsBundles(t *testing.T) {
	t.Parallel()
	server := NewServer(fakeResolver{resolved: app.ResolvedQuestionVersion{
		QuestionID: "q", QuestionVersionID: "v", VersionNumber: 2, Title: "Sum", SupportedLanguages: []string{"c", "python3"},
		TimeLimitMS: 2000, MemoryLimitKiB: 262144,
		Evaluation: app.ResolvedBundle{ObjectKey: "e", SHA256: "eh", KeyReference: "local:k", TestCaseCount: 5},
		Sample:     app.ResolvedBundle{ObjectKey: "s", SHA256: "sh", KeyReference: "local:k", TestCaseCount: 2},
	}})
	response, err := server.ResolvePublishedQuestionVersion(context.Background(), &questionbankv1.ResolvePublishedQuestionVersionRequest{QuestionVersionId: "v"})
	if err != nil {
		t.Fatalf("ResolvePublishedQuestionVersion() error = %v", err)
	}
	if response.GetEvaluationBundle().GetKeyReference() != "local:k" || response.GetEvaluationBundle().GetTestCaseCount() != 5 ||
		response.GetSampleBundle().GetObjectKey() != "s" || response.GetTimeLimitMs() != 2000 || len(response.GetSupportedLanguages()) != 2 {
		t.Fatalf("response = %v", response)
	}
}

func TestResolvePublishedQuestionVersionMapsErrors(t *testing.T) {
	t.Parallel()
	for name, scenario := range map[string]struct {
		err  error
		want codes.Code
	}{
		"not published": {apperrors.New(apperrors.CodeNotFound, "published question version not found"), codes.NotFound},
		"malformed ID":  {apperrors.New(apperrors.CodeInvalidArgument, "question version ID must be a UUID"), codes.InvalidArgument},
		"database down": {errors.New("connection refused"), codes.Internal},
	} {
		_, err := NewServer(fakeResolver{err: scenario.err}).ResolvePublishedQuestionVersion(context.Background(), &questionbankv1.ResolvePublishedQuestionVersionRequest{})
		if status.Code(err) != scenario.want {
			t.Fatalf("%s: code = %s, want %s", name, status.Code(err), scenario.want)
		}
	}
}
