package app

import (
	"context"
	"testing"

	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
)

func TestStartModelCheckRejectsWhenNotConfigured(t *testing.T) {
	t.Parallel()
	service := testService(newFakeStorage())
	// service.modelChecks is nil by default
	_, err := service.StartModelCheck(context.Background(), centralauthz.Capability{}, StartModelCheck{
		QuestionVersionID: "019c06d6-20e1-7a21-8a4f-bd8b21a43f18",
		Language:          "python3",
		Source:            "print(1)",
	})
	if err == nil {
		t.Fatal("StartModelCheck accepted call without a configured runner")
	}
}

func TestStartModelCheckRejectsInvalidVersionID(t *testing.T) {
	t.Parallel()
	service := testService(newFakeStorage())
	service.UseModelChecks(&noopModelCheckRunner{})
	_, err := service.StartModelCheck(context.Background(), centralauthz.Capability{}, StartModelCheck{
		QuestionVersionID: "not-a-uuid",
		Language:          "python3",
		Source:            "print(1)",
	})
	if err == nil {
		t.Fatal("StartModelCheck accepted non-UUID question version ID")
	}
}

func TestStartModelCheckRejectsBlankLanguageAndSource(t *testing.T) {
	t.Parallel()
	service := testService(newFakeStorage())
	service.UseModelChecks(&noopModelCheckRunner{})
	const valid = "019c06d6-20e1-7a21-8a4f-bd8b21a43f18"
	for name, cmd := range map[string]StartModelCheck{
		"blank language": {QuestionVersionID: valid, Language: "", Source: "print(1)"},
		"blank source":   {QuestionVersionID: valid, Language: "python3", Source: "  "},
		"source too big": {QuestionVersionID: valid, Language: "python3", Source: string(make([]byte, maxSolutionBytes+1))},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := service.StartModelCheck(context.Background(), centralauthz.Capability{}, cmd)
			if err == nil {
				t.Fatalf("StartModelCheck accepted invalid input for %q", name)
			}
		})
	}
}

func TestListModelChecksRejectsInvalidVersionID(t *testing.T) {
	t.Parallel()
	service := testService(newFakeStorage())
	_, err := service.ListModelChecks(context.Background(), centralauthz.Capability{}, "not-a-uuid")
	if err == nil {
		t.Fatal("ListModelChecks accepted non-UUID question version ID")
	}
}

// noopModelCheckRunner does nothing — satisfies the interface for validation tests.
type noopModelCheckRunner struct{}

func (*noopModelCheckRunner) Submit(context.Context, ModelCheckJob) error { return nil }
func (*noopModelCheckRunner) Fail(context.Context, string) error         { return nil }
