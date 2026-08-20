package httpauth

import "testing"

func TestNewRejectsMissingDependencies(t *testing.T) {
	t.Parallel()
	if _, err := New(nil, "tenant"); err == nil {
		t.Fatal("New() accepted a nil central client")
	}
}
