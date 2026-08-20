package judgecompletion

import (
	"fmt"
	"strings"
	"time"

	judgev1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/judge/v1"
	"github.com/google/uuid"
)

// Completion contains only the metadata required to durably reconcile a
// wrapper result. It deliberately has no source, test, object bytes, or KMS
// material beyond an opaque key reference.
type Completion struct {
	JudgeEventID           string
	JudgeJobID             string
	EvaluationRequestID    string
	DeliveryID             string
	LeaseID                string
	Verdict                string
	ExecutionTimeMS        *int
	MemoryKiB              *int
	ResultObjectKey        *string
	ResultChecksum         *string
	EncryptionKeyReference *string
	CompletedAt            time.Time
}

func parseCompletion(value *judgev1.Completion) (Completion, error) {
	if value == nil {
		return Completion{}, fmt.Errorf("judge completion is required")
	}
	verdict, err := verdictFromProto(value.GetVerdictCode())
	if err != nil {
		return Completion{}, err
	}
	//nolint:staticcheck // SA1019: the deprecated verdict field is read deliberately, to enforce the proto's own migration contract that it must still match verdict_code during the wire-compatibility period.
	if value.GetVerdict() != verdict {
		return Completion{}, fmt.Errorf("judge completion deprecated verdict does not match verdict_code")
	}
	completedAt, err := time.Parse(time.RFC3339Nano, value.GetCompletedAt())
	if err != nil || completedAt.IsZero() {
		return Completion{}, fmt.Errorf("judge completion completed_at is invalid")
	}
	executionTimeMS, err := optionalMetric(value.ExecutionTimeMs, "execution_time_ms")
	if err != nil {
		return Completion{}, err
	}
	memoryKiB, err := optionalMetric(value.MemoryKib, "memory_kib")
	if err != nil {
		return Completion{}, err
	}
	completion := Completion{
		JudgeEventID: value.GetEventId(), JudgeJobID: value.GetJobId(),
		EvaluationRequestID: value.GetSubmissionCorrelationId(), DeliveryID: value.GetDeliveryId(),
		LeaseID: value.GetLeaseId(), Verdict: verdict, ExecutionTimeMS: executionTimeMS,
		MemoryKiB: memoryKiB, CompletedAt: completedAt.UTC(),
	}
	if err := completion.setResultReference(
		value.GetResultRef(), value.GetResultSha256(), value.GetResultEncryptionKeyReference(),
	); err != nil {
		return Completion{}, err
	}
	if err := completion.Validate(); err != nil {
		return Completion{}, err
	}
	return completion, nil
}

func (completion *Completion) setResultReference(objectKey, checksum, keyReference string) error {
	objectKey = strings.TrimSpace(objectKey)
	checksum = strings.ToLower(strings.TrimSpace(checksum))
	keyReference = strings.TrimSpace(keyReference)
	present := objectKey != ""
	if (checksum != "") != present || (keyReference != "") != present {
		return fmt.Errorf("judge encrypted result reference, checksum, and key reference must be all-or-none")
	}
	if !present {
		return nil
	}
	completion.ResultObjectKey = &objectKey
	completion.ResultChecksum = &checksum
	completion.EncryptionKeyReference = &keyReference
	return nil
}

func (completion Completion) Validate() error {
	for field, value := range map[string]string{
		"event_id": completion.JudgeEventID, "job_id": completion.JudgeJobID,
		"submission_correlation_id": completion.EvaluationRequestID,
		"delivery_id":               completion.DeliveryID, "lease_id": completion.LeaseID,
	} {
		if !validUUIDv7(value) {
			return fmt.Errorf("judge completion %s must be a UUIDv7", field)
		}
	}
	if !validVerdict(completion.Verdict) || completion.CompletedAt.IsZero() {
		return fmt.Errorf("judge completion verdict or completion time is invalid")
	}
	if (completion.ExecutionTimeMS != nil && *completion.ExecutionTimeMS < 0) ||
		(completion.MemoryKiB != nil && *completion.MemoryKiB < 0) ||
		!sameOptionalPresence(completion.ResultObjectKey, completion.ResultChecksum, completion.EncryptionKeyReference) {
		return fmt.Errorf("judge completion metrics or encrypted result are invalid")
	}
	if completion.ResultObjectKey != nil {
		if len(*completion.ResultObjectKey) > 2048 || len(*completion.EncryptionKeyReference) > 1024 || !validSHA256(*completion.ResultChecksum) {
			return fmt.Errorf("judge completion encrypted result is invalid")
		}
	}
	return nil
}

func optionalMetric(value *uint32, field string) (*int, error) {
	if value == nil {
		return nil, nil
	}
	if uint64(*value) > 2147483647 {
		return nil, fmt.Errorf("judge completion %s exceeds Submission's signed integer range", field)
	}
	converted := int(*value)
	return &converted, nil
}

func verdictFromProto(value judgev1.CompletionVerdict) (string, error) {
	switch value {
	case judgev1.CompletionVerdict_COMPLETION_VERDICT_ACCEPTED:
		return "accepted", nil
	case judgev1.CompletionVerdict_COMPLETION_VERDICT_WRONG_ANSWER:
		return "wrong_answer", nil
	case judgev1.CompletionVerdict_COMPLETION_VERDICT_TIME_LIMIT_EXCEEDED:
		return "time_limit_exceeded", nil
	case judgev1.CompletionVerdict_COMPLETION_VERDICT_MEMORY_LIMIT_EXCEEDED:
		return "memory_limit_exceeded", nil
	case judgev1.CompletionVerdict_COMPLETION_VERDICT_RUNTIME_ERROR:
		return "runtime_error", nil
	case judgev1.CompletionVerdict_COMPLETION_VERDICT_COMPILE_ERROR:
		return "compile_error", nil
	case judgev1.CompletionVerdict_COMPLETION_VERDICT_INTERNAL_ERROR:
		return "internal_error", nil
	case judgev1.CompletionVerdict_COMPLETION_VERDICT_CANCELLED:
		return "cancelled", nil
	default:
		return "", fmt.Errorf("judge completion verdict_code is unsupported")
	}
}

func validUUIDv7(value string) bool {
	parsed, err := uuid.Parse(strings.TrimSpace(value))
	return err == nil && parsed.Version() == uuid.Version(7) && parsed.String() == strings.ToLower(strings.TrimSpace(value))
}

func validVerdict(value string) bool {
	_, err := verdictFromProto(mapVerdict(value))
	return err == nil
}

func mapVerdict(value string) judgev1.CompletionVerdict {
	switch value {
	case "accepted":
		return judgev1.CompletionVerdict_COMPLETION_VERDICT_ACCEPTED
	case "wrong_answer":
		return judgev1.CompletionVerdict_COMPLETION_VERDICT_WRONG_ANSWER
	case "time_limit_exceeded":
		return judgev1.CompletionVerdict_COMPLETION_VERDICT_TIME_LIMIT_EXCEEDED
	case "memory_limit_exceeded":
		return judgev1.CompletionVerdict_COMPLETION_VERDICT_MEMORY_LIMIT_EXCEEDED
	case "runtime_error":
		return judgev1.CompletionVerdict_COMPLETION_VERDICT_RUNTIME_ERROR
	case "compile_error":
		return judgev1.CompletionVerdict_COMPLETION_VERDICT_COMPILE_ERROR
	case "internal_error":
		return judgev1.CompletionVerdict_COMPLETION_VERDICT_INTERNAL_ERROR
	case "cancelled":
		return judgev1.CompletionVerdict_COMPLETION_VERDICT_CANCELLED
	default:
		return judgev1.CompletionVerdict_COMPLETION_VERDICT_UNSPECIFIED
	}
}

func sameOptionalPresence(values ...*string) bool {
	present := values[0] != nil
	for _, value := range values[1:] {
		if (value != nil) != present {
			return false
		}
	}
	return true
}

func validSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, character := range value {
		//nolint:staticcheck // QF1001: the negated-range form reads more clearly for character validation
		if !(character >= '0' && character <= '9') && !(character >= 'a' && character <= 'f') {
			return false
		}
	}
	return true
}
