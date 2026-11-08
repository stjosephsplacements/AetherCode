package app

import (
	"context"
	"testing"

	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
)

const testValidUUID = "018f4b0d-08f8-7c09-9ba7-efdf9c229001"

func TestPutExamPolicyRejectsInvalidIDs(t *testing.T) {
	t.Parallel()
	service := &Service{}
	for name, cmd := range map[string]PutExamPolicy{
		"non-UUID TenantID": {TenantID: "bad", ExamID: testValidUUID, ActorID: testValidUUID, Title: "T"},
		"non-UUID ExamID":   {TenantID: testValidUUID, ExamID: "bad", ActorID: testValidUUID, Title: "T"},
		"non-UUID ActorID":  {TenantID: testValidUUID, ExamID: testValidUUID, ActorID: "bad", Title: "T"},
		"blank Title":       {TenantID: testValidUUID, ExamID: testValidUUID, ActorID: testValidUUID, Title: ""},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := service.PutExamPolicy(context.Background(), centralauthz.Capability{}, cmd)
			if err == nil {
				t.Fatalf("PutExamPolicy accepted invalid input for case %q", name)
			}
		})
	}
}

func TestGetExamPolicyRejectsInvalidIDs(t *testing.T) {
	t.Parallel()
	service := &Service{}
	for name, ids := range map[string][2]string{
		"non-UUID TenantID": {"bad", testValidUUID},
		"non-UUID ExamID":   {testValidUUID, "bad"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := service.GetExamPolicy(context.Background(), centralauthz.Capability{}, ids[0], ids[1])
			if err == nil {
				t.Fatalf("GetExamPolicy accepted invalid input for case %q", name)
			}
		})
	}
}

