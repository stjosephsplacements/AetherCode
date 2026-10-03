package app

import (
	"testing"
	"time"
)

const (
	testID       = "018f4b0d-08f8-7c09-9ba7-efdf9c220101"
	testTenantID = "018f4b0d-08f8-7c09-9ba7-efdf9c220102"
	testUserID   = "018f4b0d-08f8-7c09-9ba7-efdf9c220103"
	testEventID  = "018f4b0d-08f8-7c09-9ba7-efdf9c220104"
	testHash     = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
)

func TestValidateScheduleRejectsPlaintextLikeOrInvalidReferences(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	command := ScheduleNotification{
		ID: testID, EventID: testEventID, TenantID: testTenantID, RecipientID: testUserID,
		Category: "exam_result", TemplateCode: "exam.result", ContentObjectKey: "notifications/encrypted-object",
		ContentChecksum: testHash, EncryptionKeyRef: "kms://india/notification", ScheduledAt: now.Add(time.Minute),
		IdempotencyKey: "schedule-1", RequestHash: testHash,
	}
	if err := validateSchedule(command, now); err != nil {
		t.Fatalf("validateSchedule() error = %v", err)
	}
	command.ContentObjectKey = "../../plaintext"
	if err := validateSchedule(command, now); err == nil {
		t.Fatal("validateSchedule() accepted a traversal object key")
	}
	command.ContentObjectKey = "notifications/encrypted-object"
	command.RetentionSubjectID = "not-a-uuid"
	if err := validateSchedule(command, now); err == nil {
		t.Fatal("validateSchedule() accepted an invalid retention subject")
	}
}

func TestValidateIdempotencyRejectsMissingKey(t *testing.T) {
	t.Parallel()
	if err := validateIdempotency("", testHash); err == nil {
		t.Fatal("validateIdempotency() accepted an empty key")
	}
}
