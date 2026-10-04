package judgedispatch

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func intPointer(value int) *int { return &value }

func stringPointer(value string) *string { return &value }

func validClaim() Claim {
	return Claim{
		EvaluationRequestID:          "019c06d6-20e1-7a21-8a4f-bd8b21a43f18",
		TenantID:                     "019c06d6-20e1-7a21-8a4f-bd8b21a43f19",
		EvaluationBundleObjectKey:    "qbank/evaluation/manifest.enc",
		EvaluationBundleChecksum:     strings.Repeat("A", 64),
		EvaluationBundleKeyReference: stringPointer("local/key-1"),
		SourceObjectKey:              "candidate-source/t/a/r",
		SourceChecksum:               strings.Repeat("b", 64),
		SourceKeyReference:           "local/key-2",
		LanguageID:                   "python3",
		TimeLimitMS:                  intPointer(2000),
		MemoryLimitKiB:               intPointer(262144),
		ExpiresAt:                    time.Date(2026, 10, 4, 12, 0, 0, 5, time.UTC),
	}
}

func TestBuildRequestMapsClaimOntoJudgeContract(t *testing.T) {
	t.Parallel()
	claim := validClaim()
	request, err := buildRequest(claim)
	if err != nil {
		t.Fatalf("buildRequest() error = %v", err)
	}
	if request.GetIdempotencyKey() != claim.EvaluationRequestID || request.GetSubmissionCorrelationId() != claim.EvaluationRequestID {
		t.Fatalf("idempotency %q / correlation %q must both be the evaluation request id", request.GetIdempotencyKey(), request.GetSubmissionCorrelationId())
	}
	if request.GetTenantFairnessKey() != claim.TenantID || request.GetLanguageKey() != "python3" {
		t.Fatalf("tenant %q / language %q", request.GetTenantFairnessKey(), request.GetLanguageKey())
	}
	if request.GetEvaluationBundleRef() != claim.EvaluationBundleObjectKey || request.GetEvaluationBundleKeyReference() != "local/key-1" ||
		request.GetEvaluationBundleSha256() != strings.Repeat("a", 64) {
		t.Fatalf("bundle reference = %q %q %q", request.GetEvaluationBundleRef(), request.GetEvaluationBundleKeyReference(), request.GetEvaluationBundleSha256())
	}
	if request.GetSourceCiphertextRef() != claim.SourceObjectKey || request.GetSourceKeyReference() != "local/key-2" ||
		request.GetSourceCiphertextSha256() != claim.SourceChecksum {
		t.Fatalf("source reference = %q %q %q", request.GetSourceCiphertextRef(), request.GetSourceKeyReference(), request.GetSourceCiphertextSha256())
	}
	if request.GetRequestCiphertextRef() != "" {
		t.Fatalf("request_ciphertext_ref = %q, want empty", request.GetRequestCiphertextRef())
	}
	limits := request.GetLimits()
	if limits.GetCpuTimeMs() != 2000 || limits.GetWallTimeMs() != 6000 || limits.GetMemoryBytes() != 262144*1024 || limits.GetProcessLimit() != processLimit {
		t.Fatalf("limits = %v", limits)
	}
	if request.GetExpiresAt() != "2026-10-04T12:00:00.000000005Z" {
		t.Fatalf("expires_at = %q", request.GetExpiresAt())
	}
	again, _ := buildRequest(claim)
	if again.GetExpiresAt() != request.GetExpiresAt() {
		t.Fatal("a replayed claim must produce the identical request for Judge's idempotency fingerprint")
	}
}

func TestBuildRequestClampsLimitsToJudgeBounds(t *testing.T) {
	t.Parallel()
	testCases := []struct {
		name        string
		timeMS      int
		memoryKiB   int
		wantCPU     uint32
		wantWall    uint32
		wantMemory  uint64
		wantInvalid bool
	}{
		{name: "within bounds", timeMS: 1000, memoryKiB: 65536, wantCPU: 1000, wantWall: 3000, wantMemory: 65536 * 1024},
		{name: "cpu above judge maximum", timeMS: 600000, memoryKiB: 65536, wantCPU: 60000, wantWall: 120000, wantMemory: 65536 * 1024},
		{name: "wall capped", timeMS: 50000, memoryKiB: 65536, wantCPU: 50000, wantWall: 120000, wantMemory: 65536 * 1024},
		{name: "memory above judge maximum", timeMS: 1000, memoryKiB: 4194304, wantCPU: 1000, wantWall: 3000, wantMemory: 2 << 30},
		{name: "memory below judge minimum", timeMS: 1000, memoryKiB: 512, wantInvalid: true},
		{name: "zero time", timeMS: 0, memoryKiB: 65536, wantInvalid: true},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			claim := validClaim()
			claim.TimeLimitMS, claim.MemoryLimitKiB = intPointer(testCase.timeMS), intPointer(testCase.memoryKiB)
			request, err := buildRequest(claim)
			if testCase.wantInvalid {
				if !errors.Is(err, errNotExecutable) {
					t.Fatalf("buildRequest() error = %v, want errNotExecutable", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("buildRequest() error = %v", err)
			}
			limits := request.GetLimits()
			if limits.GetCpuTimeMs() != testCase.wantCPU || limits.GetWallTimeMs() != testCase.wantWall || limits.GetMemoryBytes() != testCase.wantMemory {
				t.Fatalf("limits = %v", limits)
			}
		})
	}
}

func TestBuildRequestRejectsLegacyItems(t *testing.T) {
	t.Parallel()
	for name, mutate := range map[string]func(*Claim){
		"no key reference": func(c *Claim) { c.EvaluationBundleKeyReference = nil },
		"no time limit":    func(c *Claim) { c.TimeLimitMS = nil },
		"no memory limit":  func(c *Claim) { c.MemoryLimitKiB = nil },
	} {
		claim := validClaim()
		mutate(&claim)
		if _, err := buildRequest(claim); !errors.Is(err, errNotExecutable) {
			t.Errorf("%s: error = %v, want errNotExecutable", name, err)
		}
	}
}
