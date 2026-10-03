package main

import "testing"

func TestValidateArgumentsRejectsBadInput(t *testing.T) {
	t.Parallel()
	testCases := []struct {
		name      string
		email     string
		display   string
		wantError bool
	}{
		{name: "valid", email: "admin@college.edu", display: "Platform Admin"},
		{name: "empty email", email: "", display: "Platform Admin", wantError: true},
		{name: "no at sign", email: "admincollege.edu", display: "Admin", wantError: true},
		{name: "at sign first", email: "@college.edu", display: "Admin", wantError: true},
		{name: "empty display name", email: "admin@college.edu", display: "", wantError: true},
		{name: "whitespace display name", email: "admin@college.edu", display: "   ", wantError: true},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			err := validateArguments(testCase.email, testCase.display)
			if (err != nil) != testCase.wantError {
				t.Fatalf("validateArguments(%q, %q) error = %v, wantError = %t",
					testCase.email, testCase.display, err, testCase.wantError)
			}
		})
	}
}
