package authz

import "testing"

func TestCanonicalPolicyEngineUsesOnlyProvidedRules(t *testing.T) {
	t.Parallel()
	engine, err := NewEngineFromRules([]PolicyRule{{
		PType:  "p",
		Values: []string{"college_admin", "college", "/*", "*"},
	}})
	if err != nil {
		t.Fatalf("NewEngineFromRules() error = %v", err)
	}
	allowed, err := engine.Authorize(RoleCollegeAdmin, "college", "/attempts/attempt-123", "write")
	if err != nil {
		t.Fatalf("Authorize() error = %v", err)
	}
	if !allowed {
		t.Fatal("canonical wildcard policy did not allow matching operation")
	}
	denied, err := engine.Authorize(RoleStudent, "self", "/attempts/attempt-123", "write")
	if err != nil {
		t.Fatalf("Authorize() error = %v", err)
	}
	if denied {
		t.Fatal("engine allowed a role without a canonical policy")
	}
}

func TestCanonicalPolicyEngineRejectsMalformedRule(t *testing.T) {
	t.Parallel()
	if _, err := NewEngineFromRules([]PolicyRule{{PType: "g", Values: []string{"a", "b"}}}); err == nil {
		t.Fatal("NewEngineFromRules() accepted an unsupported policy row")
	}
}
