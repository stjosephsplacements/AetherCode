package domain

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestQuestion_SoftDelete(t *testing.T) {
	questionID := uuid.New()
	actorID := uuid.New()

	t.Run("successful soft delete", func(t *testing.T) {
		question := &Question{
			ID:             questionID,
			Slug:           "test-question",
			LifecycleState: StatusPublished,
		}

		err := question.SoftDelete(actorID, "Question deprecated")
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if question.DeletedAt == nil {
			t.Error("expected DeletedAt to be set")
		}
		if question.DeletedBy == nil || *question.DeletedBy != actorID {
			t.Error("expected DeletedBy to be set to actor ID")
		}
		if question.DeletionReason == nil || *question.DeletionReason != "Question deprecated" {
			t.Error("expected DeletionReason to be set")
		}
		if !question.IsDeleted() {
			t.Error("expected IsDeleted to return true")
		}
	})

	t.Run("reject soft delete without reason", func(t *testing.T) {
		question := &Question{
			ID:   questionID,
			Slug: "test-question",
		}

		err := question.SoftDelete(actorID, "")
		if err == nil {
			t.Fatal("expected error for missing deletion reason")
		}
	})

	t.Run("reject soft delete on already deleted question", func(t *testing.T) {
		now := time.Now()
		question := &Question{
			ID:        questionID,
			DeletedAt: &now,
		}

		err := question.SoftDelete(actorID, "Reason")
		if err == nil {
			t.Fatal("expected error for already deleted question")
		}
	})
}

// Hard delete authorization is enforced by the Casbin central authorization service
// (via AuthorizeHTTP with action "delete"), not at the domain entity level.

func TestQuestionVersion_SoftDelete(t *testing.T) {
	versionID := uuid.New()
	actorID := uuid.New()

	t.Run("successful soft delete", func(t *testing.T) {
		version := &QuestionVersion{
			ID:            versionID,
			VersionNumber: 1,
			Status:        "published",
		}

		err := version.SoftDelete(actorID, "Version retracted due to errors")
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if version.DeletedAt == nil {
			t.Error("expected DeletedAt to be set")
		}
		if version.DeletedBy == nil || *version.DeletedBy != actorID {
			t.Error("expected DeletedBy to be set to actor ID")
		}
		if version.DeletionReason == nil || *version.DeletionReason != "Version retracted due to errors" {
			t.Error("expected DeletionReason to be set")
		}
		if !version.IsDeleted() {
			t.Error("expected IsDeleted to return true")
		}
	})

	t.Run("reject soft delete without reason", func(t *testing.T) {
		version := &QuestionVersion{
			ID:            versionID,
			VersionNumber: 1,
		}

		err := version.SoftDelete(actorID, "")
		if err == nil {
			t.Fatal("expected error for missing deletion reason")
		}
	})

	t.Run("reject soft delete on already deleted version", func(t *testing.T) {
		now := time.Now()
		version := &QuestionVersion{
			ID:        versionID,
			DeletedAt: &now,
		}

		err := version.SoftDelete(actorID, "Reason")
		if err == nil {
			t.Fatal("expected error for already deleted version")
		}
	})
}

// Hard delete authorization is enforced by the Casbin central authorization service
// (via AuthorizeHTTP with action "delete"), not at the domain entity level.
