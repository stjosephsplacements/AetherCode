// Package grpcadapter exposes the private Judge wrapper gRPC contract.
package grpcadapter

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/ratelimit"
	judgev1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/judge/v1"
	"github.com/aethercode/aethercode/services/judge/internal/app"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Server is the concrete Judge API. Every method persists or reads wrapper
// control-plane state; it is not a proxy to Judge0.
type Server struct {
	judgev1.UnimplementedJudgeServiceServer
	service *app.Service
	limiter *ratelimit.Limiter
}

// NewServer constructs a Judge gRPC adapter. limiter may be nil to disable
// per-tenant submission rate limiting.
func NewServer(service *app.Service, limiter *ratelimit.Limiter) *Server {
	return &Server{service: service, limiter: limiter}
}

// SubmitExecution durably accepts a deduplicated wrapper job.
func (server *Server) SubmitExecution(
	contextValue context.Context,
	request *judgev1.SubmitExecutionRequest,
) (*judgev1.SubmitExecutionResponse, error) {
	if request == nil {
		return nil, status.Error(codes.InvalidArgument, "execution request is required")
	}
	// An empty tenant_fairness_key is a permanent validation failure that
	// app.Service.Submit rejects with InvalidArgument below; check it before
	// consulting the limiter so that case is never reported as
	// ResourceExhausted (Limiter.Allow denies an empty key by design, which
	// would otherwise turn a non-retryable error into a retryable one).
	if server.limiter != nil && request.GetTenantFairnessKey() != "" {
		// TenantFairnessKey is the opaque dispatch-fairness key: it already
		// exists to prevent one tenant from starving others' throughput, so it
		// is also the correct key for admission rate limiting.
		if !server.limiter.Allow(request.GetTenantFairnessKey(), time.Now().UTC()) {
			return nil, status.Error(codes.ResourceExhausted, "submission rate exceeded")
		}
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, request.GetExpiresAt())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "expires_at must be RFC3339Nano")
	}
	limits := request.GetLimits()
	execution, err := server.service.Submit(contextValue, app.SubmitExecution{
		IdempotencyKey:          request.GetIdempotencyKey(),
		TenantFairnessKey:       request.GetTenantFairnessKey(),
		SubmissionCorrelationID: request.GetSubmissionCorrelationId(),
		EvaluationBundleRef:     request.GetEvaluationBundleRef(),
		EvaluationBundleSHA256:  request.GetEvaluationBundleSha256(),
		SourceCiphertextRef:     request.GetSourceCiphertextRef(),
		SourceCiphertextSHA256:  request.GetSourceCiphertextSha256(),
		RequestCiphertextRef:    request.GetRequestCiphertextRef(),
		LanguageKey:             request.GetLanguageKey(),
		Limits: app.Limits{
			CPUTimeMS:  limits.GetCpuTimeMs(),
			WallTimeMS: limits.GetWallTimeMs(),
			Memory:     limits.GetMemoryBytes(),
			Processes:  limits.GetProcessLimit(),
		},
		ExpiresAt: expiresAt,
	})
	if err != nil {
		return nil, toStatusError(err)
	}
	return &judgev1.SubmitExecutionResponse{JobId: execution.ID, Status: execution.Status}, nil
}

// PullCompletedExecutions leases terminal results to the submission adapter.
func (server *Server) PullCompletedExecutions(
	contextValue context.Context,
	request *judgev1.PullCompletedExecutionsRequest,
) (*judgev1.PullCompletedExecutionsResponse, error) {
	if request == nil {
		return nil, status.Error(codes.InvalidArgument, "pull request is required")
	}
	completions, err := server.service.Pull(contextValue, app.PullCompletedExecutions{
		ConsumerID:   request.GetConsumerId(),
		Limit:        request.GetLimit(),
		LeaseSeconds: request.GetLeaseSeconds(),
	})
	if err != nil {
		return nil, toStatusError(err)
	}
	response := &judgev1.PullCompletedExecutionsResponse{
		Completions: make([]*judgev1.Completion, 0, len(completions)),
	}
	for _, completion := range completions {
		verdictCode, verdictErr := completionVerdictCode(completion.Verdict)
		if verdictErr != nil {
			return nil, status.Error(codes.Internal, "Judge completion vocabulary is invalid")
		}
		unitResults := make([]*judgev1.UnitResult, 0, len(completion.UnitResults))
		for _, unit := range completion.UnitResults {
			unitVerdictCode, unitVerdictErr := completionVerdictCode(unit.Verdict)
			if unitVerdictErr != nil {
				return nil, status.Error(codes.Internal, "Judge completion vocabulary is invalid")
			}
			result := &judgev1.UnitResult{UnitNumber: uint32(unit.UnitNumber), VerdictCode: unitVerdictCode}
			if unit.TimeMS != nil {
				timeMS := uint32(*unit.TimeMS)
				result.ExecutionTimeMs = &timeMS
			}
			if unit.MemoryKB != nil {
				memoryKiB := uint32(*unit.MemoryKB)
				result.MemoryKib = &memoryKiB
			}
			unitResults = append(unitResults, result)
		}
		response.Completions = append(response.Completions, &judgev1.Completion{
			EventId:                      completion.EventID,
			JobId:                        completion.JobID,
			SubmissionCorrelationId:      completion.SubmissionCorrelationID,
			ResultRef:                    completion.ResultRef,
			ResultSha256:                 completion.ResultSHA256,
			ResultEncryptionKeyReference: completion.ResultEncryptionKeyRef,
			Verdict:                      completion.Verdict,
			VerdictCode:                  verdictCode,
			ExecutionTimeMs:              completion.ExecutionTimeMS,
			MemoryKib:                    completion.MemoryKiB,
			DeliveryId:                   completion.DeliveryID,
			LeaseId:                      completion.LeaseID,
			CompletedAt:                  completion.CompletedAt.UTC().Format(time.RFC3339Nano),
			UnitResults:                  unitResults,
		})
	}
	return response, nil
}

// AcknowledgeCompletion records durable consumption of exactly one result
// lease; stale or replayed acknowledgements cannot retire a newer delivery.
func (server *Server) AcknowledgeCompletion(
	contextValue context.Context,
	request *judgev1.AcknowledgeCompletionRequest,
) (*judgev1.AcknowledgeCompletionResponse, error) {
	if request == nil {
		return nil, status.Error(codes.InvalidArgument, "acknowledgement request is required")
	}
	if err := server.service.Acknowledge(contextValue, app.AcknowledgeCompletion{
		ConsumerID: request.GetConsumerId(),
		EventID:    request.GetEventId(),
		DeliveryID: request.GetDeliveryId(),
		LeaseID:    request.GetLeaseId(),
	}); err != nil {
		return nil, toStatusError(err)
	}
	return &judgev1.AcknowledgeCompletionResponse{}, nil
}

// DeleteExecutionJob soft-deletes a job, retaining it with an audit trail.
func (server *Server) DeleteExecutionJob(
	contextValue context.Context,
	request *judgev1.DeleteExecutionJobRequest,
) (*judgev1.DeleteExecutionJobResponse, error) {
	if request == nil {
		return nil, status.Error(codes.InvalidArgument, "delete request is required")
	}
	if err := server.service.DeleteExecutionJob(contextValue, app.DeleteExecutionJob{
		ID:      request.GetId(),
		ActorID: request.GetActorId(),
		Reason:  request.GetReason(),
	}); err != nil {
		return nil, toStatusError(err)
	}
	return &judgev1.DeleteExecutionJobResponse{}, nil
}

// HardDeleteExecutionJob permanently removes a job. SuperAdmin only; callers
// enforce that authorization boundary before invoking this RPC.
func (server *Server) HardDeleteExecutionJob(
	contextValue context.Context,
	request *judgev1.HardDeleteExecutionJobRequest,
) (*judgev1.HardDeleteExecutionJobResponse, error) {
	if request == nil {
		return nil, status.Error(codes.InvalidArgument, "delete request is required")
	}
	if err := server.service.HardDeleteExecutionJob(contextValue, app.DeleteExecutionJob{
		ID:      request.GetId(),
		ActorID: request.GetActorId(),
		Reason:  request.GetReason(),
	}); err != nil {
		return nil, toStatusError(err)
	}
	return &judgev1.HardDeleteExecutionJobResponse{}, nil
}

func completionVerdictCode(value string) (judgev1.CompletionVerdict, error) {
	switch value {
	case "accepted":
		return judgev1.CompletionVerdict_COMPLETION_VERDICT_ACCEPTED, nil
	case "wrong_answer":
		return judgev1.CompletionVerdict_COMPLETION_VERDICT_WRONG_ANSWER, nil
	case "time_limit_exceeded":
		return judgev1.CompletionVerdict_COMPLETION_VERDICT_TIME_LIMIT_EXCEEDED, nil
	case "memory_limit_exceeded":
		return judgev1.CompletionVerdict_COMPLETION_VERDICT_MEMORY_LIMIT_EXCEEDED, nil
	case "runtime_error":
		return judgev1.CompletionVerdict_COMPLETION_VERDICT_RUNTIME_ERROR, nil
	case "compile_error":
		return judgev1.CompletionVerdict_COMPLETION_VERDICT_COMPILE_ERROR, nil
	case "internal_error":
		return judgev1.CompletionVerdict_COMPLETION_VERDICT_INTERNAL_ERROR, nil
	case "cancelled":
		return judgev1.CompletionVerdict_COMPLETION_VERDICT_CANCELLED, nil
	default:
		return judgev1.CompletionVerdict_COMPLETION_VERDICT_UNSPECIFIED, fmt.Errorf("unsupported verdict")
	}
}

func toStatusError(err error) error {
	var validationError *app.ValidationError
	switch {
	case errors.As(err, &validationError):
		return status.Error(codes.InvalidArgument, validationError.Error())
	case errors.Is(err, app.ErrIdempotencyConflict):
		return status.Error(codes.AlreadyExists, err.Error())
	case errors.Is(err, app.ErrLanguageUnavailable):
		return status.Error(codes.FailedPrecondition, err.Error())
	case errors.Is(err, app.ErrCompletionNotLeased):
		return status.Error(codes.FailedPrecondition, err.Error())
	case errors.Is(err, app.ErrFanOutUnavailable):
		return status.Error(codes.FailedPrecondition, err.Error())
	default:
		return status.Error(codes.Internal, "Judge operation failed")
	}
}
