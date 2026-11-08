package app

import (
	"context"
	"testing"

	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
)

const practiceTestUUID = "019c06d6-20e1-7a21-8a4f-bd8b21a43f18"

func TestSetQuestionAudienceRejectsInvalidAudienceAndID(t *testing.T) {
	t.Parallel()
	service := testService(newFakeStorage())
	for name, cmd := range map[string]SetQuestionAudience{
		"non-UUID QuestionID":  {QuestionID: "bad", Audience: "practice"},
		"unknown audience":     {QuestionID: practiceTestUUID, Audience: "exam"},
		"empty audience":       {QuestionID: practiceTestUUID, Audience: ""},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			err := service.SetQuestionAudience(context.Background(), centralauthz.Capability{}, cmd)
			if err == nil {
				t.Fatalf("SetQuestionAudience accepted invalid input for %q", name)
			}
		})
	}
}

func TestSetQuestionAudienceAcceptsBothValidAudiences(t *testing.T) {
	t.Parallel()
	service := testService(newFakeStorage())
	for _, audience := range []string{"test", "practice"} {
		// Validation passes; nil pool will cause a non-invalid-argument error.
		err := service.SetQuestionAudience(context.Background(), centralauthz.Capability{},
			SetQuestionAudience{QuestionID: practiceTestUUID, Audience: audience})
		if err != nil && err.Error() == "audience must be test or practice" {
			t.Fatalf("SetQuestionAudience rejected valid audience %q", audience)
		}
	}
}

func TestListPracticeSubmissionsRejectsInvalidQuestionID(t *testing.T) {
	t.Parallel()
	service := testService(newFakeStorage())
	_, err := service.ListPracticeSubmissions(context.Background(), centralauthz.Capability{}, "not-a-uuid")
	if err == nil {
		t.Fatal("ListPracticeSubmissions accepted non-UUID question ID")
	}
}

func TestGetPracticeQuestionRejectsInvalidID(t *testing.T) {
	t.Parallel()
	service := testService(newFakeStorage())
	_, err := service.GetPracticeQuestion(context.Background(), centralauthz.Capability{}, "not-a-uuid")
	if err == nil {
		t.Fatal("GetPracticeQuestion accepted non-UUID question ID")
	}
}

func TestGetPracticeSubmissionRejectsInvalidID(t *testing.T) {
	t.Parallel()
	service := testService(newFakeStorage())
	_, err := service.GetPracticeSubmission(context.Background(), centralauthz.Capability{}, "not-a-uuid")
	if err == nil {
		t.Fatal("GetPracticeSubmission accepted non-UUID ID")
	}
}

func TestStartPracticeRejectsWhenJudgeNotConfigured(t *testing.T) {
	t.Parallel()
	service := testService(newFakeStorage()) // modelChecks is nil
	_, err := service.StartPractice(context.Background(), centralauthz.Capability{}, StartPractice{
		QuestionID: practiceTestUUID, Language: "python3", Mode: "run", Source: "print(1)",
	})
	if err == nil {
		t.Fatal("StartPractice accepted call without configured judge")
	}
}

func TestStartPracticeRejectsInvalidFields(t *testing.T) {
	t.Parallel()
	service := testService(newFakeStorage())
	service.UseModelChecks(&noopModelCheckRunner{})
	for name, cmd := range map[string]StartPractice{
		"non-UUID QuestionID": {QuestionID: "bad", Language: "python3", Mode: "run", Source: "print(1)"},
		"blank language":      {QuestionID: practiceTestUUID, Language: "", Mode: "run", Source: "print(1)"},
		"unknown mode":        {QuestionID: practiceTestUUID, Language: "python3", Mode: "grade", Source: "print(1)"},
		"blank source":        {QuestionID: practiceTestUUID, Language: "python3", Mode: "run", Source: "   "},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := service.StartPractice(context.Background(), centralauthz.Capability{}, cmd)
			if err == nil {
				t.Fatalf("StartPractice accepted invalid input for %q", name)
			}
		})
	}
}
