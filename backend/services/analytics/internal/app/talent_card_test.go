package app

import (
	"testing"
	"time"
)

func TestClaimsHideWhatConsentAndBlindEvaluationHide(t *testing.T) {
	t.Parallel()
	identity := TalentCardIdentity{DisplayName: "Asha", College: "St Joseph's", Department: "CSE", RollNumber: "21CS001", Email: "a@x.in", Phone: "99999"}
	top := 10
	now := time.Unix(1000, 0)
	metrics := talentMetrics{ExamCount: 2, TopPercent: &top}

	open := claimsFor("c", now, now, identity, metrics)
	if open.Name != "Asha" || open.College == "" || open.Email != "" || open.Phone != "" || open.RollNumber != "" {
		t.Fatalf("default card = %+v, want the name and college but no contact data or roll number", open)
	}
	metrics.ShareContactInfo = true
	shared := claimsFor("c", now, now, identity, metrics)
	if shared.Email != "a@x.in" || shared.RollNumber != "21CS001" || shared.Phone != "99999" {
		t.Fatalf("consenting card = %+v, want contact data", shared)
	}
	metrics.BlindEvaluation = true
	blind := claimsFor("c", now, now, identity, metrics)
	if blind.Name != "" || blind.College != "" || blind.Department != "" || blind.Email == "" {
		t.Fatalf("blind card = %+v, want no name, college or department", blind)
	}
}

func TestTalentCardIdentityValidation(t *testing.T) {
	t.Parallel()
	good := TalentCardIdentity{DisplayName: "Asha"}
	if err := good.validate(); err != nil {
		t.Fatalf("a name alone is valid: %v", err)
	}
	for name, bad := range map[string]TalentCardIdentity{
		"no name":      {},
		"newline":      {DisplayName: "A\nB"},
		"email no at":  {DisplayName: "A", Email: "nope"},
		"long phone":   {DisplayName: "A", Phone: "123456789012345678901"},
		"long college": {DisplayName: "A", College: string(make([]byte, 121))},
	} {
		if err := bad.validate(); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
