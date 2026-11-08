package app

import (
	"testing"

	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
)

func TestRepinExamItemRejectsInvalidIDs(t *testing.T) {
	t.Parallel()
	const valid = "00000000-0000-7000-8000-000000000001"
	service := &Service{}
	for name, cmd := range map[string]RepinExamItem{
		"non-UUID TenantID":          {TenantID: "bad", ExamVersionID: valid, ItemID: valid, QuestionVersionID: valid},
		"non-UUID ExamVersionID":     {TenantID: valid, ExamVersionID: "bad", ItemID: valid, QuestionVersionID: valid},
		"non-UUID ItemID":            {TenantID: valid, ExamVersionID: valid, ItemID: "bad", QuestionVersionID: valid},
		"non-UUID QuestionVersionID": {TenantID: valid, ExamVersionID: valid, ItemID: valid, QuestionVersionID: "bad"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := service.RepinExamItem(t.Context(), centralauthz.Capability{}, cmd)
			assertInvalid(t, err)
		})
	}
}
