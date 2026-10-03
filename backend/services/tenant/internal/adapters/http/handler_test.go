package httpadapter

import "testing"

func TestNewHandlerRejectsNilDependencies(t *testing.T) {
	t.Parallel()
	if _, err := NewHandler("tenant", nil, nil, nil); err == nil {
		t.Fatal("NewHandler() accepted nil service and authorizer")
	}
}
