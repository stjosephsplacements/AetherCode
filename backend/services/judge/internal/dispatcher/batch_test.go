package dispatcher

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"testing"
)

// batchEngine is a fakeEngine that also runs a program's units as one job.
type batchEngine struct {
	fakeEngine
	batches    [][]UnitRequest
	batchErr   error
	verdicts   map[string]*UnitVerdict
	forgotten  []string
	nextBatch  int
	pollsToken []string
	// status is the verdict every unit of a batch gets; accepted when empty.
	status string
}

func (b *batchEngine) SubmitBatch(_ context.Context, requests []UnitRequest) ([]string, error) {
	if b.batchErr != nil {
		return nil, b.batchErr
	}
	b.batches = append(b.batches, requests)
	tokens := make([]string, len(requests))
	for i := range requests {
		b.nextBatch++
		tokens[i] = fmt.Sprintf("batch-token-%d", b.nextBatch)
		status := b.status
		if status == "" {
			status = "accepted"
		}
		b.verdicts[tokens[i]] = &UnitVerdict{Status: status, Stdout: requests[i].Stdin}
	}
	return tokens, nil
}

func (b *batchEngine) Poll(_ context.Context, token string) (*UnitVerdict, error) {
	b.pollsToken = append(b.pollsToken, token)
	if v, ok := b.verdicts[token]; ok {
		delete(b.verdicts, token)
		return v, nil
	}
	return b.fakeEngine.Poll(context.Background(), token)
}

func (b *batchEngine) Forget(token string) {
	b.forgotten = append(b.forgotten, token)
	delete(b.verdicts, token)
}

func units(n int) []DispatchUnit {
	out := make([]DispatchUnit, n)
	for i := range out {
		out[i] = DispatchUnit{ID: fmt.Sprintf("u%d", i), Language: "python3", SourceCode: "print(input())", Stdin: fmt.Sprint(i), TimeLimitMS: 1000, MemLimitKB: 65536}
	}
	return out
}

func newBatchWorker(t *testing.T, engine *batchEngine, job *DispatchJob) (*Worker, *fakeStore) {
	t.Helper()
	store := newFakeStore(job)
	worker, err := NewWorker(store, engine, Runtime{Enabled: true, MaxPollAttempts: 3, PollIntervalMS: 1}, slog.New(slog.NewTextHandler(os.Stderr, nil)))
	if err != nil {
		t.Fatal(err)
	}
	return worker, store
}

func TestDispatchJob_SendsAJobsUnitsToABatchEngineInOneJob(t *testing.T) {
	engine := &batchEngine{fakeEngine: fakeEngine{verdict: &UnitVerdict{Status: "accepted"}}, verdicts: map[string]*UnitVerdict{}}
	job := &DispatchJob{ID: "job-1", Units: units(5)}
	worker, store := newBatchWorker(t, engine, job)

	if err := worker.DispatchJob(context.Background(), "job-1"); err != nil {
		t.Fatalf("DispatchJob: %v", err)
	}
	if len(engine.batches) != 1 || len(engine.batches[0]) != 5 {
		t.Fatalf("batches = %d (first has %d units), want one batch of 5", len(engine.batches), len(engine.batches[0]))
	}
	if engine.fakeEngine.submitCalls != 0 {
		t.Fatalf("single submits = %d, want none: the batch covers every unit", engine.fakeEngine.submitCalls)
	}
	for i := range 5 {
		id := fmt.Sprintf("u%d", i)
		if store.recordedTokens[id] == "" {
			t.Errorf("unit %s has no recorded token", id)
		}
		if got := store.recordedVerdicts[id]; got.Status != "accepted" {
			t.Errorf("unit %s verdict = %+v, want accepted", id, got)
		}
		if got := engine.batches[0][i].IdempotencyKey; got != id {
			t.Errorf("request %d idempotency key = %q, want the unit id %q", i, got, id)
		}
	}
	if _, done := store.completedJobs["job-1"]; !done {
		t.Error("job was not marked complete")
	}
}

func TestDispatchJob_ChunksLargeJobsAtTheBatchLimit(t *testing.T) {
	engine := &batchEngine{fakeEngine: fakeEngine{verdict: &UnitVerdict{Status: "accepted"}}, verdicts: map[string]*UnitVerdict{}}
	job := &DispatchJob{ID: "job-2", Units: units(MaxBatchUnits + 20)}
	worker, _ := newBatchWorker(t, engine, job)
	if err := worker.DispatchJob(context.Background(), "job-2"); err != nil {
		t.Fatalf("DispatchJob: %v", err)
	}
	if len(engine.batches) != 2 || len(engine.batches[0]) != MaxBatchUnits || len(engine.batches[1]) != 20 {
		t.Fatalf("batches = %v, want %d then 20", len(engine.batches), MaxBatchUnits)
	}
}

func TestDispatchJob_FallsBackToOneByOneWhenTheBatchFails(t *testing.T) {
	engine := &batchEngine{fakeEngine: fakeEngine{verdict: &UnitVerdict{Status: "accepted"}}, verdicts: map[string]*UnitVerdict{}, batchErr: errors.New("engine busy")}
	job := &DispatchJob{ID: "job-3", Units: units(3)}
	worker, store := newBatchWorker(t, engine, job)
	if err := worker.DispatchJob(context.Background(), "job-3"); err != nil {
		t.Fatalf("DispatchJob: %v", err)
	}
	if engine.fakeEngine.submitCalls != 3 {
		t.Fatalf("single submits = %d, want 3 after the batch failed", engine.fakeEngine.submitCalls)
	}
	if len(store.recordedVerdicts) != 3 {
		t.Fatalf("verdicts recorded = %d, want 3", len(store.recordedVerdicts))
	}
}

func TestDispatchJob_AUnitAlreadySubmittedKeepsItsToken(t *testing.T) {
	engine := &batchEngine{fakeEngine: fakeEngine{verdict: &UnitVerdict{Status: "accepted"}}, verdicts: map[string]*UnitVerdict{}}
	all := units(3)
	all[0].Token = "earlier-token"
	job := &DispatchJob{ID: "job-4", Units: all}
	worker, _ := newBatchWorker(t, engine, job)
	if err := worker.DispatchJob(context.Background(), "job-4"); err != nil {
		t.Fatalf("DispatchJob: %v", err)
	}
	if len(engine.batches) != 1 || len(engine.batches[0]) != 2 {
		t.Fatalf("batch sizes = %v, want one batch of the 2 units without a token", engine.batches)
	}
	if engine.pollsToken[0] != "earlier-token" {
		t.Fatalf("first poll = %q, want the earlier token", engine.pollsToken[0])
	}
}

func TestDispatchJob_ACompileErrorReleasesTheRestOfTheBatch(t *testing.T) {
	engine := &batchEngine{verdicts: map[string]*UnitVerdict{}, status: "compile_error"}
	job := &DispatchJob{ID: "job-5", Units: units(4)}
	worker, store := newBatchWorker(t, engine, job)
	if err := worker.DispatchJob(context.Background(), "job-5"); err != nil {
		t.Fatalf("DispatchJob: %v", err)
	}
	for i := range 4 {
		if got := store.recordedVerdicts[fmt.Sprintf("u%d", i)]; got.Status != "compile_error" {
			t.Errorf("unit u%d verdict = %+v, want compile_error", i, got)
		}
	}
	// Only the first unit's verdict was polled; the other three were released, not left behind.
	if len(engine.pollsToken) != 1 || len(engine.forgotten) < 3 || len(engine.verdicts) != 0 {
		t.Fatalf("polls = %d, forgotten = %d, left = %d, want 1 poll, 3 released and none left", len(engine.pollsToken), len(engine.forgotten), len(engine.verdicts))
	}
}

func TestDispatchJob_UnitsOfDifferentProgramsAreNotBatched(t *testing.T) {
	engine := &batchEngine{fakeEngine: fakeEngine{verdict: &UnitVerdict{Status: "accepted"}}, verdicts: map[string]*UnitVerdict{}}
	all := units(2)
	all[1].SourceCode = "print('other')"
	job := &DispatchJob{ID: "job-6", Units: all}
	worker, _ := newBatchWorker(t, engine, job)
	if err := worker.DispatchJob(context.Background(), "job-6"); err != nil {
		t.Fatalf("DispatchJob: %v", err)
	}
	if len(engine.batches) != 0 || engine.fakeEngine.submitCalls != 2 {
		t.Fatalf("batches = %d, single submits = %d, want 0 and 2", len(engine.batches), engine.fakeEngine.submitCalls)
	}
}
