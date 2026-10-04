package judgedispatch

import (
	"errors"
	"fmt"
	"strings"
	"time"

	judgev1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/judge/v1"
)

// Bounds Judge's SubmitExecution validation enforces. A question's limits are
// authored against wider ranges (up to 10 minutes and 4 GiB), so they are
// clamped here rather than failing a candidate's grade over an over-generous
// limit.
const (
	maxCPUTimeMS   = 60_000
	maxWallTimeMS  = 120_000
	maxMemoryBytes = 2 << 30
	// wallTimeFactor leaves room for process start-up and compilation outside
	// the CPU budget; Judge itself scales slower runtimes' limits further.
	wallTimeFactor = 3
	// processLimit covers a JVM's threads and a compiler's children.
	processLimit = 64
)

// Failure codes recorded on an evaluation request that can never be graded.
const (
	failureNotExecutable = "item_not_executable"
	failureJudgeRejected = "judge_rejected"
)

// errNotExecutable marks a claim whose exam item was projected without a key
// reference or execution limits (pinned before Assessment migration 000024),
// so no Judge request can be built for it.
var errNotExecutable = errors.New("exam item has no key reference or execution limits")

// Claim is one queued evaluation request with everything Judge needs. The
// optional fields are null for items projected before Assessment migration
// 000024.
type Claim struct {
	EvaluationRequestID          string
	TenantID                     string
	EvaluationBundleObjectKey    string
	EvaluationBundleChecksum     string
	EvaluationBundleKeyReference *string
	SourceObjectKey              string
	SourceChecksum               string
	SourceKeyReference           string
	LanguageID                   string
	TimeLimitMS                  *int
	MemoryLimitKiB               *int
	ExpiresAt                    time.Time
}

// buildRequest maps a claim onto Judge's contract. The evaluation request id is
// both the idempotency key and the correlation id, and expires_at is derived
// from the request, so a replay after a crash is the identical request and
// Judge returns the job it already accepted.
func buildRequest(claim Claim) (*judgev1.SubmitExecutionRequest, error) {
	if claim.EvaluationBundleKeyReference == nil || claim.TimeLimitMS == nil || claim.MemoryLimitKiB == nil {
		return nil, errNotExecutable
	}
	cpuTimeMS := min(*claim.TimeLimitMS, maxCPUTimeMS)
	memoryBytes := min(uint64(*claim.MemoryLimitKiB)*1024, maxMemoryBytes)
	if cpuTimeMS < 1 || memoryBytes < 1<<20 {
		return nil, fmt.Errorf("execution limits are out of range: %w", errNotExecutable)
	}
	return &judgev1.SubmitExecutionRequest{
		IdempotencyKey:               claim.EvaluationRequestID,
		TenantFairnessKey:            claim.TenantID,
		SubmissionCorrelationId:      claim.EvaluationRequestID,
		EvaluationBundleRef:          claim.EvaluationBundleObjectKey,
		EvaluationBundleSha256:       strings.ToLower(claim.EvaluationBundleChecksum),
		EvaluationBundleKeyReference: *claim.EvaluationBundleKeyReference,
		SourceCiphertextRef:          claim.SourceObjectKey,
		SourceCiphertextSha256:       strings.ToLower(claim.SourceChecksum),
		SourceKeyReference:           claim.SourceKeyReference,
		LanguageKey:                  claim.LanguageID,
		Limits: &judgev1.ExecutionLimits{
			CpuTimeMs:    uint32(cpuTimeMS),
			WallTimeMs:   uint32(min(cpuTimeMS*wallTimeFactor, maxWallTimeMS)),
			MemoryBytes:  memoryBytes,
			ProcessLimit: processLimit,
		},
		ExpiresAt: claim.ExpiresAt.UTC().Format(time.RFC3339Nano),
	}, nil
}
