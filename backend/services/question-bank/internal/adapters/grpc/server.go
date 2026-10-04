// Package grpcadapter serves Question Bank's internal service contract to
// other platform services over mTLS.
package grpcadapter

import (
	"context"
	"errors"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	questionbankv1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/questionbank/v1"
	"github.com/aethercode/aethercode/services/question-bank/internal/app"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type Resolver interface {
	ResolvePublishedQuestionVersion(context.Context, string) (app.ResolvedQuestionVersion, error)
}

type Server struct {
	questionbankv1.UnimplementedQuestionBankInternalServiceServer
	resolver Resolver
}

func NewServer(resolver Resolver) *Server {
	return &Server{resolver: resolver}
}

func (server *Server) ResolvePublishedQuestionVersion(contextValue context.Context, request *questionbankv1.ResolvePublishedQuestionVersionRequest) (*questionbankv1.ResolvePublishedQuestionVersionResponse, error) {
	resolved, err := server.resolver.ResolvePublishedQuestionVersion(contextValue, request.GetQuestionVersionId())
	if err != nil {
		return nil, statusFor(err)
	}
	return &questionbankv1.ResolvePublishedQuestionVersionResponse{
		QuestionId:         resolved.QuestionID,
		QuestionVersionId:  resolved.QuestionVersionID,
		VersionNumber:      uint32(resolved.VersionNumber),
		Title:              resolved.Title,
		SupportedLanguages: resolved.SupportedLanguages,
		TimeLimitMs:        uint32(resolved.TimeLimitMS),
		MemoryLimitKib:     uint32(resolved.MemoryLimitKiB),
		EvaluationBundle:   bundle(resolved.Evaluation),
		SampleBundle:       bundle(resolved.Sample),
	}, nil
}

func bundle(resolved app.ResolvedBundle) *questionbankv1.EncryptedBundle {
	return &questionbankv1.EncryptedBundle{
		ObjectKey: resolved.ObjectKey, Sha256: resolved.SHA256,
		KeyReference: resolved.KeyReference, TestCaseCount: uint32(resolved.TestCaseCount),
	}
}

func statusFor(err error) error {
	var domainError *apperrors.Error
	if errors.As(err, &domainError) {
		switch domainError.Code {
		case apperrors.CodeNotFound:
			return status.Error(codes.NotFound, domainError.Message)
		case apperrors.CodeInvalidArgument:
			return status.Error(codes.InvalidArgument, domainError.Message)
		}
	}
	return status.Error(codes.Internal, "question version could not be resolved")
}
