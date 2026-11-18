package app

import "testing"

func TestGridSeverity(t *testing.T) {
	t.Parallel()
	three, zero := 3, 0
	for _, test := range []struct {
		name  string
		total int
		kinds map[string]int
		max   *int
		want  string
	}{
		{"clean", 0, nil, nil, "green"},
		{"below half of the default", 2, nil, nil, "green"},
		{"half of the default", 3, nil, nil, "amber"},
		{"at the default limit", 5, nil, nil, "red"},
		{"policy limit reached", 3, nil, &three, "red"},
		{"policy half rounds up", 2, nil, &three, "amber"},
		{"a phone is amber alone", 1, map[string]int{"phone_detected": 1}, nil, "amber"},
		{"a zero limit falls back to the default", 4, nil, &zero, "amber"},
	} {
		if got := GridSeverity(test.total, test.kinds, test.max); got != test.want {
			t.Errorf("%s: severity = %s, want %s", test.name, got, test.want)
		}
	}
}

func TestCountedTotal(t *testing.T) {
	t.Parallel()
	kinds := map[string]int{"face_missing": 3, "gaze_away": 4, "phone_detected": 1}
	for _, test := range []struct {
		name    string
		counted []string
		want    int
	}{
		{"no named kinds counts everything", nil, 8},
		{"unknown names count everything", []string{"SOMETHING_ELSE"}, 8},
		{"one named kind", []string{"NO_FACE"}, 3},
		{"two named kinds", []string{"NO_FACE", "PROHIBITED_DEVICE"}, 4},
		{"a named kind with no violations", []string{"MULTIPLE_FACES"}, 0},
		{"a detector name counts like its policy name", []string{"phone_detected"}, 1},
		{"an alias and its detector name count once", []string{"NO_FACE", "face_missing"}, 3},
	} {
		if got := CountedTotal(8, kinds, test.counted); got != test.want {
			t.Errorf("%s: counted = %d, want %d", test.name, got, test.want)
		}
	}
}
