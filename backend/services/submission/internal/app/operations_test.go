package app

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
)

// newValidationService builds a Service with a nil pool and the no-op store
// used by service_test.go — sufficient to test validation before any I/O.
func newValidationService(t *testing.T) *Service {
	t.Helper()
	service, err := NewService(&pgxpool.Pool{}, validationStore{}, nil, nil)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	return service
}

// ── choices.go ────────────────────────────────────────────────────────────────

func TestSaveChoiceRejectsInvalidIDs(t *testing.T) {
	t.Parallel()
	service := newValidationService(t)
	for name, cmd := range map[string]SaveChoice{
		"non-UUID TenantID":   {TenantID: "bad", AttemptID: validSubmissionTestUUID, ExamItemID: validSubmissionTestUUID},
		"non-UUID AttemptID":  {TenantID: validSubmissionTestUUID, AttemptID: "bad", ExamItemID: validSubmissionTestUUID},
		"non-UUID ExamItemID": {TenantID: validSubmissionTestUUID, AttemptID: validSubmissionTestUUID, ExamItemID: "bad"},
		"too many selected":   {TenantID: validSubmissionTestUUID, AttemptID: validSubmissionTestUUID, ExamItemID: validSubmissionTestUUID, Selected: make([]int, 11)},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := service.SaveChoice(context.Background(), centralauthz.Capability{}, cmd)
			assertInvalidArgument(t, err)
		})
	}
}

// ── operations.go — ExamVersionCommand ───────────────────────────────────────

func TestExamVersionCommandRejectsInvalidIDs(t *testing.T) {
	t.Parallel()
	service := newValidationService(t)
	for name, cmd := range map[string]ExamVersionCommand{
		"non-UUID TenantID":      {TenantID: "bad", ExamVersionID: validSubmissionTestUUID},
		"non-UUID ExamVersionID": {TenantID: validSubmissionTestUUID, ExamVersionID: "bad"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := service.GetExamMonitor(context.Background(), centralauthz.Capability{}, cmd)
			assertInvalidArgument(t, err)
		})
	}
}

func TestReleaseResultsRejectsInvalidExamVersionID(t *testing.T) {
	t.Parallel()
	service := newValidationService(t)
	_, err := service.ReleaseResults(context.Background(), centralauthz.Capability{}, ReleaseResults{
		ExamVersionCommand: ExamVersionCommand{TenantID: validSubmissionTestUUID, ExamVersionID: "bad"},
	})
	assertInvalidArgument(t, err)
}

func TestExtendDeadlinesRejectsBadMinutes(t *testing.T) {
	t.Parallel()
	service := newValidationService(t)
	for name, cmd := range map[string]ExtendDeadlines{
		"zero minutes":     {ExamVersionCommand: ExamVersionCommand{TenantID: validSubmissionTestUUID, ExamVersionID: validSubmissionTestUUID}, Minutes: 0},
		"241 minutes":      {ExamVersionCommand: ExamVersionCommand{TenantID: validSubmissionTestUUID, ExamVersionID: validSubmissionTestUUID}, Minutes: 241},
		"bad attempt UUID": {ExamVersionCommand: ExamVersionCommand{TenantID: validSubmissionTestUUID, ExamVersionID: validSubmissionTestUUID}, AttemptID: "bad", Minutes: 10},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := service.ExtendDeadlines(context.Background(), centralauthz.Capability{}, cmd)
			assertInvalidArgument(t, err)
		})
	}
}

func TestPostAnnouncementRejectsBlankAndOversizeBody(t *testing.T) {
	t.Parallel()
	service := newValidationService(t)
	base := ExamVersionCommand{TenantID: validSubmissionTestUUID, ExamVersionID: validSubmissionTestUUID}
	for name, body := range map[string]string{
		"blank body":    "   ",
		"oversize body": string(make([]rune, 2001)),
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := service.PostAnnouncement(context.Background(), centralauthz.Capability{},
				PostAnnouncement{ExamVersionCommand: base, Body: body})
			assertInvalidArgument(t, err)
		})
	}
}

func TestGetAttemptLiveStateRejectsInvalidIDs(t *testing.T) {
	t.Parallel()
	service := newValidationService(t)
	_, err := service.GetAttemptLiveState(context.Background(), centralauthz.Capability{},
		GetAttempt{TenantID: "bad", AttemptID: validSubmissionTestUUID})
	assertInvalidArgument(t, err)
}

func TestGetAttemptResultRejectsInvalidIDs(t *testing.T) {
	t.Parallel()
	service := newValidationService(t)
	_, err := service.GetAttemptResult(context.Background(), centralauthz.Capability{},
		GetAttempt{TenantID: validSubmissionTestUUID, AttemptID: "bad"})
	assertInvalidArgument(t, err)
}

func TestRecordIntegrityEventRejectsInvalidKindAndIDs(t *testing.T) {
	t.Parallel()
	service := newValidationService(t)
	valid := GetAttempt{TenantID: validSubmissionTestUUID, AttemptID: validSubmissionTestUUID}
	for name, tc := range map[string]struct {
		cmd  GetAttempt
		kind string
	}{
		"unknown kind":   {valid, "unknown"},
		"empty kind":     {valid, ""},
		"bad tenant":     {GetAttempt{TenantID: "bad", AttemptID: validSubmissionTestUUID}, "blur"},
		"bad attempt":    {GetAttempt{TenantID: validSubmissionTestUUID, AttemptID: "bad"}, "paste"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			err := service.RecordIntegrityEvent(context.Background(), centralauthz.Capability{}, tc.cmd, tc.kind)
			assertInvalidArgument(t, err)
		})
	}
}

func TestRecordIntegrityEventAcceptsAllValidKinds(t *testing.T) {
	t.Parallel()
	service := newValidationService(t)
	cmd := GetAttempt{TenantID: validSubmissionTestUUID, AttemptID: validSubmissionTestUUID}
	for _, kind := range []string{"blur", "paste", "fullscreen_exit"} {
		// Validation passes; nil pool causes a non-invalid-argument error.
		err := service.RecordIntegrityEvent(context.Background(), centralauthz.Capability{}, cmd, kind)
		if err != nil {
			var appErr *apperrors.Error
			if errors.As(err, &appErr) && appErr.Code == apperrors.CodeInvalidArgument {
				t.Fatalf("RecordIntegrityEvent rejected valid kind %q", kind)
			}
		}
	}
}

func TestRegradeItemRejectsInvalidItemID(t *testing.T) {
	t.Parallel()
	service := newValidationService(t)
	base := ExamVersionCommand{TenantID: validSubmissionTestUUID, ExamVersionID: validSubmissionTestUUID}
	_, err := service.RegradeItem(context.Background(), centralauthz.Capability{}, base, "not-a-uuid")
	assertInvalidArgument(t, err)
}

func TestGetGradingQueueRejectsInvalidTenantID(t *testing.T) {
	t.Parallel()
	service := newValidationService(t)
	_, err := service.GetGradingQueue(context.Background(), centralauthz.Capability{}, "bad")
	assertInvalidArgument(t, err)
}

func TestSetIntegrityRejectsInvalidExamVersionID(t *testing.T) {
	t.Parallel()
	service := newValidationService(t)
	err := service.SetIntegrity(context.Background(), centralauthz.Capability{}, SetIntegrity{
		ExamVersionCommand: ExamVersionCommand{TenantID: "bad", ExamVersionID: validSubmissionTestUUID},
	})
	assertInvalidArgument(t, err)
}

// ── item_submit.go ────────────────────────────────────────────────────────────

func TestSubmitItemRejectsInvalidIDs(t *testing.T) {
	t.Parallel()
	service := newValidationService(t)
	for name, cmd := range map[string]SubmitItem{
		"non-UUID TenantID":   {TenantID: "bad", AttemptID: validSubmissionTestUUID, ExamItemID: validSubmissionTestUUID},
		"non-UUID AttemptID":  {TenantID: validSubmissionTestUUID, AttemptID: "bad", ExamItemID: validSubmissionTestUUID},
		"non-UUID ExamItemID": {TenantID: validSubmissionTestUUID, AttemptID: validSubmissionTestUUID, ExamItemID: "bad"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := service.SubmitItem(context.Background(), centralauthz.Capability{}, cmd)
			assertInvalidArgument(t, err)
		})
	}
}

func TestListItemSubmissionsRejectsInvalidIDs(t *testing.T) {
	t.Parallel()
	service := newValidationService(t)
	_, err := service.ListItemSubmissions(context.Background(), centralauthz.Capability{}, SubmitItem{
		TenantID: validSubmissionTestUUID, AttemptID: validSubmissionTestUUID, ExamItemID: "bad",
	})
	assertInvalidArgument(t, err)
}

// ── similarity.go ─────────────────────────────────────────────────────────────

func TestSimilarityReportRejectsInvalidExamVersionID(t *testing.T) {
	t.Parallel()
	service := newValidationService(t)
	_, err := service.SimilarityReport(context.Background(), centralauthz.Capability{}, ExamVersionCommand{
		TenantID: validSubmissionTestUUID, ExamVersionID: "bad",
	})
	assertInvalidArgument(t, err)
}

// ── review.go ─────────────────────────────────────────────────────────────────

func TestReviewAttemptRejectsInvalidAttemptID(t *testing.T) {
	t.Parallel()
	service, err := NewService(&pgxpool.Pool{}, validationStore{}, &memoryStorage{objects: map[string][]byte{}}, &fakeKMS{})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	_, err = service.ReviewAttempt(context.Background(), centralauthz.Capability{}, GetAttempt{
		TenantID: validSubmissionTestUUID, AttemptID: "bad",
	})
	assertInvalidArgument(t, err)
}
