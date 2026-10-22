// Package judge makes Question Bank a Judge client for model-solution checks
// (ADR-0033) and practice runs (ADR-0041). It submits each as an execution job
// under its own mTLS identity, so Judge returns to it only its own
// completions, and records each completion's per-test verdicts, with a sample
// run's output, through the projection worker role.
package judge

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/config"
	"github.com/aethercode/aethercode/libs/pkg/evalbundle"
	"github.com/aethercode/aethercode/libs/pkg/kms"
	"github.com/aethercode/aethercode/libs/pkg/storage"
	judgev1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/judge/v1"
	"github.com/aethercode/aethercode/services/question-bank/internal/app"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
)

const (
	rpcTimeout   = 10 * time.Second
	pollInterval = 2 * time.Second
	pullLimit    = 20
	leaseSeconds = 60
	// Judge's accepted bounds, as Submission's dispatcher applies them.
	maxCPUTimeMS   = 60_000
	maxWallTimeMS  = 120_000
	maxMemoryBytes = 2 << 30
	wallTimeFactor = 3
	processLimit   = 64
	// fairnessKey groups model checks in Judge's fair scheduling.
	fairnessKey = "question-bank:model-checks"
	jobLifetime = time.Hour
	// maxOutputCiphertextBytes bounds one unit's encrypted output object.
	maxOutputCiphertextBytes = 4 << 20
)

// Runtime is the Judge endpoint and the client identity. An empty address
// turns model checks off.
type Runtime struct {
	Address    string
	CertFile   string
	KeyFile    string
	CAFile     string
	ServerName string
	ConsumerID string
}

// LoadRuntime reads QBANK_JUDGE_*; the certificate defaults to Question
// Bank's own (QBANK_GRPC_TLS_*), whose subject Judge must allow.
func LoadRuntime() (Runtime, error) {
	runtime := Runtime{
		Address:    strings.TrimSpace(os.Getenv("QBANK_JUDGE_GRPC_ADDR")),
		CertFile:   firstSet("QBANK_JUDGE_TLS_CERT_FILE", "QBANK_GRPC_TLS_CERT_FILE"),
		KeyFile:    firstSet("QBANK_JUDGE_TLS_KEY_FILE", "QBANK_GRPC_TLS_KEY_FILE"),
		CAFile:     firstSet("QBANK_JUDGE_TLS_CA_FILE", "QBANK_GRPC_CLIENT_CA_FILE"),
		ServerName: strings.TrimSpace(os.Getenv("QBANK_JUDGE_TLS_SERVER_NAME")),
		ConsumerID: firstSet("QBANK_JUDGE_CONSUMER_ID"),
	}
	if runtime.Address == "" {
		return runtime, nil
	}
	host, _, err := net.SplitHostPort(runtime.Address)
	if err != nil || host == "" {
		return Runtime{}, fmt.Errorf("QBANK_JUDGE_GRPC_ADDR must be host:port")
	}
	if runtime.CertFile == "" || runtime.KeyFile == "" || runtime.CAFile == "" {
		return Runtime{}, fmt.Errorf("model checks need a client certificate, key and CA (QBANK_JUDGE_TLS_* or QBANK_GRPC_TLS_*)")
	}
	if runtime.ServerName == "" {
		runtime.ServerName = host
	}
	if runtime.ConsumerID == "" {
		runtime.ConsumerID = "question-bank-model-checks"
	}
	return runtime, nil
}

func firstSet(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

// ModelChecks submits checks and practice runs to Judge and records their
// outcomes.
type ModelChecks struct {
	client  judgev1.JudgeServiceClient
	workers *pgxpool.Pool
	runtime Runtime
	logger  *slog.Logger
	// storage and keys read a sample run's per-test output.
	storage storage.Object
	keys    kms.KeyManager
}

// New dials Judge lazily; workers is the projection worker pool, which may
// only finish model checks and practice runs.
func New(runtime Runtime, workers *pgxpool.Pool, logger *slog.Logger) (*ModelChecks, *grpc.ClientConn, error) {
	tlsConfig, err := config.LoadMTLSClientConfig(runtime.CertFile, runtime.KeyFile, runtime.CAFile, runtime.ServerName)
	if err != nil {
		return nil, nil, err
	}
	connection, err := grpc.NewClient(runtime.Address, grpc.WithTransportCredentials(credentials.NewTLS(tlsConfig)))
	if err != nil {
		return nil, nil, fmt.Errorf("configure Judge client: %w", err)
	}
	return &ModelChecks{client: judgev1.NewJudgeServiceClient(connection), workers: workers, runtime: runtime, logger: logger}, connection, nil
}

// Submit sends one check to Judge. The check id is the idempotency key and
// the correlation id, so a retry is the same job.
func (checks *ModelChecks) Submit(contextValue context.Context, check app.ModelCheckJob) error {
	cpuTimeMS := min(check.TimeLimitMS, maxCPUTimeMS)
	callContext, cancel := context.WithTimeout(contextValue, rpcTimeout)
	defer cancel()
	key := check.FairnessKey
	if key == "" {
		key = fairnessKey
	}
	_, err := checks.client.SubmitExecution(callContext, &judgev1.SubmitExecutionRequest{
		IdempotencyKey:               check.ID,
		TenantFairnessKey:            key,
		SubmissionCorrelationId:      check.ID,
		EvaluationBundleRef:          check.Bundle.ObjectKey,
		EvaluationBundleSha256:       check.Bundle.Checksum,
		EvaluationBundleKeyReference: check.Bundle.EncryptionKeyReference,
		SourceCiphertextRef:          check.Source.ObjectKey,
		SourceCiphertextSha256:       check.Source.Checksum,
		SourceKeyReference:           check.Source.EncryptionKeyReference,
		LanguageKey:                  check.Language,
		Limits: &judgev1.ExecutionLimits{
			CpuTimeMs:    uint32(cpuTimeMS),
			WallTimeMs:   uint32(min(cpuTimeMS*wallTimeFactor, maxWallTimeMS)),
			MemoryBytes:  min(uint64(check.MemoryLimitKiB)*1024, maxMemoryBytes),
			ProcessLimit: processLimit,
		},
		ExpiresAt: time.Now().Add(jobLifetime).UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		return fmt.Errorf("submit model check to Judge: %w", err)
	}
	return nil
}

// ReadOutputsWith lets the worker decrypt a sample run's per-test output.
func (checks *ModelChecks) ReadOutputsWith(objects storage.Object, keys kms.KeyManager) {
	checks.storage, checks.keys = objects, keys
}

// Fail marks a check or practice run Judge never accepted.
func (checks *ModelChecks) Fail(contextValue context.Context, id string) error {
	return checks.finish(contextValue, id, "failed", "internal_error", "[]")
}

// finish records a job's outcome on the model check or practice run it
// belongs to; an id that is neither is still acknowledged.
func (checks *ModelChecks) finish(contextValue context.Context, id, state, verdict, units string) error {
	for _, function := range []string{"finish_model_check", "finish_practice_submission"} {
		var found bool
		if err := checks.workers.QueryRow(contextValue, `SELECT qbank.`+function+`($1, $2, $3, $4::jsonb)`,
			id, state, verdict, units).Scan(&found); err != nil {
			return fmt.Errorf("record %s: %w", function, err)
		}
		if found {
			return nil
		}
	}
	checks.logger.Warn("judge completion for an unknown job", "correlation_id", id)
	return nil
}

type unitOutcome struct {
	UnitNumber    uint32  `json:"unit_number"`
	Verdict       string  `json:"verdict"`
	Weight        uint32  `json:"weight"`
	TimeMS        *uint32 `json:"time_ms,omitempty"`
	MemoryKiB     *uint32 `json:"memory_kib,omitempty"`
	Stdin         *string `json:"stdin,omitempty"`
	Expected      *string `json:"expected_output,omitempty"`
	Stdout        *string `json:"stdout,omitempty"`
	Stderr        *string `json:"stderr,omitempty"`
	CompileOutput *string `json:"compile_output,omitempty"`
}

// Run pulls this client's completions until the context ends.
func (checks *ModelChecks) Run(contextValue context.Context) {
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	for {
		if err := checks.pullOnce(contextValue); err != nil && contextValue.Err() == nil {
			checks.logger.Warn("model check completions", "error", err)
		}
		select {
		case <-contextValue.Done():
			return
		case <-ticker.C:
		}
	}
}

func (checks *ModelChecks) pullOnce(contextValue context.Context) error {
	callContext, cancel := context.WithTimeout(contextValue, rpcTimeout)
	defer cancel()
	response, err := checks.client.PullCompletedExecutions(callContext, &judgev1.PullCompletedExecutionsRequest{
		ConsumerId: checks.runtime.ConsumerID, Limit: pullLimit, LeaseSeconds: leaseSeconds,
	})
	if err != nil {
		return fmt.Errorf("pull completions: %w", err)
	}
	for _, completion := range response.GetCompletions() {
		units := make([]unitOutcome, 0, len(completion.GetUnitResults()))
		for _, unit := range completion.GetUnitResults() {
			outcome := unitOutcome{
				UnitNumber: unit.GetUnitNumber(), Verdict: verdictName(unit.GetVerdictCode()),
				Weight: unit.GetWeight(), TimeMS: unit.ExecutionTimeMs, MemoryKiB: unit.MemoryKib,
			}
			// Only a sample bundle's units carry output (ADR-0041).
			if unit.GetResultRef() != "" {
				// An unreadable output must not block the queue: the verdict
				// still counts, without the output.
				output, err := checks.readOutput(contextValue, unit)
				if err != nil {
					checks.logger.Warn("practice run output", "correlation_id", completion.GetSubmissionCorrelationId(), "error", err)
					units = append(units, outcome)
					continue
				}
				outcome.Stdin, outcome.Expected, outcome.Stdout = &output.Stdin, &output.ExpectedOutput, &output.Stdout
				outcome.Stderr, outcome.CompileOutput = &output.Stderr, &output.CompileOutput
			}
			units = append(units, outcome)
		}
		encoded, err := json.Marshal(units)
		if err != nil {
			return err
		}
		if err := checks.finish(contextValue, completion.GetSubmissionCorrelationId(), "completed",
			verdictName(completion.GetVerdictCode()), string(encoded)); err != nil {
			return err
		}
		ackContext, ackCancel := context.WithTimeout(contextValue, rpcTimeout)
		_, err = checks.client.AcknowledgeCompletion(ackContext, &judgev1.AcknowledgeCompletionRequest{
			ConsumerId: checks.runtime.ConsumerID, EventId: completion.GetEventId(),
			DeliveryId: completion.GetDeliveryId(), LeaseId: completion.GetLeaseId(),
		})
		ackCancel()
		if err != nil {
			return fmt.Errorf("acknowledge completion: %w", err)
		}
	}
	return nil
}

// readOutput fetches, verifies and decrypts one unit's output object.
func (checks *ModelChecks) readOutput(contextValue context.Context, unit *judgev1.UnitResult) (evalbundle.UnitOutput, error) {
	if checks.storage == nil || checks.keys == nil {
		return evalbundle.UnitOutput{}, fmt.Errorf("run output cannot be read: storage is not configured")
	}
	object, _, err := checks.storage.Get(contextValue, unit.GetResultRef())
	if err != nil {
		return evalbundle.UnitOutput{}, fmt.Errorf("fetch run output: %w", err)
	}
	defer func() { _ = object.Close() }()
	ciphertext, err := io.ReadAll(io.LimitReader(object, maxOutputCiphertextBytes+1))
	if err != nil {
		return evalbundle.UnitOutput{}, fmt.Errorf("read run output: %w", err)
	}
	digest := sha256.Sum256(ciphertext)
	if len(ciphertext) > maxOutputCiphertextBytes || hex.EncodeToString(digest[:]) != unit.GetResultSha256() {
		return evalbundle.UnitOutput{}, fmt.Errorf("run output object is too large or does not match its checksum")
	}
	plaintext, err := checks.keys.Decrypt(contextValue, ciphertext, unit.GetResultEncryptionKeyReference())
	if err != nil {
		return evalbundle.UnitOutput{}, fmt.Errorf("decrypt run output: %w", err)
	}
	return evalbundle.ParseUnitOutput(plaintext)
}

// verdictName is Judge's verdict in the platform's vocabulary.
func verdictName(code judgev1.CompletionVerdict) string {
	switch code {
	case judgev1.CompletionVerdict_COMPLETION_VERDICT_ACCEPTED:
		return "accepted"
	case judgev1.CompletionVerdict_COMPLETION_VERDICT_WRONG_ANSWER:
		return "wrong_answer"
	case judgev1.CompletionVerdict_COMPLETION_VERDICT_TIME_LIMIT_EXCEEDED:
		return "time_limit_exceeded"
	case judgev1.CompletionVerdict_COMPLETION_VERDICT_MEMORY_LIMIT_EXCEEDED:
		return "memory_limit_exceeded"
	case judgev1.CompletionVerdict_COMPLETION_VERDICT_RUNTIME_ERROR:
		return "runtime_error"
	case judgev1.CompletionVerdict_COMPLETION_VERDICT_COMPILE_ERROR:
		return "compile_error"
	case judgev1.CompletionVerdict_COMPLETION_VERDICT_CANCELLED:
		return "cancelled"
	default:
		return "internal_error"
	}
}
