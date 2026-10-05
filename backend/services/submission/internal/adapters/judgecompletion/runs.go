package judgecompletion

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"

	"github.com/aethercode/aethercode/libs/pkg/evalbundle"
	"github.com/aethercode/aethercode/libs/pkg/kms"
	"github.com/aethercode/aethercode/libs/pkg/storage"
)

// maxOutputCiphertextBytes bounds one unit output object: five fields of at
// most 64 KiB each, JSON escaping, and the envelope's overhead.
const maxOutputCiphertextBytes = 4 << 20

// OutputReader fetches and decrypts one unit's output object.
type OutputReader interface {
	Read(context.Context, OutputReference) (evalbundle.UnitOutput, error)
}

// ObjectOutputReader reads output objects from object storage and decrypts
// them with KMS after checking the ciphertext against Judge's checksum.
type ObjectOutputReader struct {
	storage storage.Object
	kms     kms.KeyManager
}

func NewObjectOutputReader(objectStorage storage.Object, keyManager kms.KeyManager) (*ObjectOutputReader, error) {
	if objectStorage == nil || keyManager == nil {
		return nil, fmt.Errorf("object storage and KMS are required to read run output")
	}
	return &ObjectOutputReader{storage: objectStorage, kms: keyManager}, nil
}

func (reader *ObjectOutputReader) Read(contextValue context.Context, reference OutputReference) (evalbundle.UnitOutput, error) {
	object, _, err := reader.storage.Get(contextValue, reference.ObjectKey)
	if err != nil {
		return evalbundle.UnitOutput{}, fmt.Errorf("fetch run output: %w", err)
	}
	defer func() { _ = object.Close() }()
	ciphertext, err := io.ReadAll(io.LimitReader(object, maxOutputCiphertextBytes+1))
	if err != nil {
		return evalbundle.UnitOutput{}, fmt.Errorf("read run output: %w", err)
	}
	if len(ciphertext) > maxOutputCiphertextBytes {
		return evalbundle.UnitOutput{}, fmt.Errorf("run output object exceeds %d bytes", maxOutputCiphertextBytes)
	}
	digest := sha256.Sum256(ciphertext)
	if hex.EncodeToString(digest[:]) != reference.Checksum {
		return evalbundle.UnitOutput{}, fmt.Errorf("run output object does not match its checksum")
	}
	plaintext, err := reader.kms.Decrypt(contextValue, ciphertext, reference.KeyReference)
	if err != nil {
		return evalbundle.UnitOutput{}, fmt.Errorf("decrypt run output: %w", err)
	}
	return evalbundle.ParseUnitOutput(plaintext)
}

// RunTarget identifies the run a Judge job belongs to.
type RunTarget struct {
	TenantID string
	RunID    string
}

// RunCompletion is a run's completion with each unit's decrypted output.
type RunCompletion struct {
	Target     RunTarget
	JudgeJobID string
	Verdict    string
	Units      []RunUnit
}

// RunUnit is one sample test's outcome as record_code_run_completion stores it.
type RunUnit struct {
	UnitNumber      int     `json:"unit_number"`
	Verdict         string  `json:"verdict"`
	Stdin           *string `json:"stdin"`
	ExpectedOutput  *string `json:"expected_output"`
	Stdout          *string `json:"stdout"`
	Stderr          *string `json:"stderr"`
	CompileOutput   *string `json:"compile_output"`
	ExecutionTimeMS *int    `json:"execution_time_ms"`
	MemoryKiB       *int    `json:"memory_kib"`
}

// runCompletion decrypts every unit's output. A unit without an output
// reference keeps its verdict and timing only.
func runCompletion(contextValue context.Context, reader OutputReader, target RunTarget, completion Completion) (RunCompletion, error) {
	run := RunCompletion{Target: target, JudgeJobID: completion.JudgeJobID, Verdict: completion.Verdict, Units: make([]RunUnit, 0, len(completion.UnitResults))}
	for _, unit := range completion.UnitResults {
		recorded := RunUnit{UnitNumber: unit.UnitNumber, Verdict: unit.Verdict, ExecutionTimeMS: unit.ExecutionTimeMS, MemoryKiB: unit.MemoryKiB}
		if unit.Output != nil {
			output, err := reader.Read(contextValue, *unit.Output)
			if err != nil {
				return RunCompletion{}, fmt.Errorf("unit %d: %w", unit.UnitNumber, err)
			}
			recorded.Stdin, recorded.ExpectedOutput = &output.Stdin, &output.ExpectedOutput
			recorded.Stdout, recorded.Stderr, recorded.CompileOutput = &output.Stdout, &output.Stderr, &output.CompileOutput
		}
		run.Units = append(run.Units, recorded)
	}
	return run, nil
}
