package dispatcher

import "testing"

func TestOverallVerdict(t *testing.T) {
	tests := []struct {
		name  string
		units []string
		want  string
	}{
		{"all accepted", []string{"accepted", "accepted"}, "accepted"},
		{"no units", nil, "accepted"},
		{"wrong answer beats accepted", []string{"accepted", "wrong_answer"}, "wrong_answer"},
		{"memory limit beats wrong answer", []string{"wrong_answer", "memory_limit_exceeded"}, "memory_limit_exceeded"},
		{"time limit beats memory limit", []string{"memory_limit_exceeded", "time_limit_exceeded"}, "time_limit_exceeded"},
		{"runtime error beats time limit", []string{"time_limit_exceeded", "runtime_error"}, "runtime_error"},
		{"internal error beats runtime error", []string{"runtime_error", "internal_error"}, "internal_error"},
		{"compile error beats everything", []string{"internal_error", "compile_error", "wrong_answer"}, "compile_error"},
		{"order does not matter", []string{"runtime_error", "wrong_answer"}, "runtime_error"},
		{"unknown verdict is internal error", []string{"accepted", "cancelled"}, "internal_error"},
		{"unknown verdict loses to compile error", []string{"cancelled", "compile_error"}, "compile_error"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := OverallVerdict(tt.units); got != tt.want {
				t.Errorf("OverallVerdict(%v) = %q, want %q", tt.units, got, tt.want)
			}
		})
	}
}
