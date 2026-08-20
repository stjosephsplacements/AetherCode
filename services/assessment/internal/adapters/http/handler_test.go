package httpadapter

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIdempotencyKeyRequiresPrintableHeader(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name    string
		key     string
		wantErr bool
	}{
		{name: "valid", key: "assessment:01JTEST"},
		{name: "missing", wantErr: true},
		{name: "space", key: "has space", wantErr: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/", nil)
			if testCase.key != "" {
				request.Header.Set("Idempotency-Key", testCase.key)
			}
			_, err := idempotencyKey(request)
			if (err != nil) != testCase.wantErr {
				t.Fatalf("idempotencyKey() error = %v, wantErr = %t", err, testCase.wantErr)
			}
		})
	}
}
