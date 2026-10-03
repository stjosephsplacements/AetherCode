package main

import "testing"

func TestValidateArgumentsRejectsBadInput(t *testing.T) {
	t.Parallel()
	testCases := []struct {
		name      string
		action    string
		audience  string
		wantError bool
	}{
		{name: "valid publish", action: "publish", audience: "aether_submission", wantError: false},
		{name: "valid retire", action: "retire", audience: "aether_user", wantError: false},
		{name: "invalid action", action: "delete", audience: "aether_user", wantError: true},
		{name: "empty action", action: "", audience: "aether_user", wantError: true},
		{name: "empty audience", action: "publish", audience: "", wantError: true},
		{name: "uppercase audience", action: "publish", audience: "Aether_User", wantError: true},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			err := validateArguments(testCase.action, testCase.audience)
			if (err != nil) != testCase.wantError {
				t.Fatalf("validateArguments(%q, %q) error = %v, wantError = %t",
					testCase.action, testCase.audience, err, testCase.wantError)
			}
		})
	}
}
