package authn

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/services/user/internal/app"
	userconfig "github.com/aethercode/aethercode/services/user/internal/config"
)

var testAudit = app.AccountAudit{ActorID: "019b11a0-0000-7000-8000-000000000001", RequestID: "019b11a0-0000-7000-8000-000000000002"}

func newTestAccountsClient(t *testing.T, handler http.HandlerFunc) *AccountsClient {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	client, err := NewAccountsClient(userconfig.IdentityIntrospectionRuntime{URL: server.URL + "/v1/internal/access-token/validate"})
	if err != nil {
		t.Fatalf("NewAccountsClient() error = %v", err)
	}
	return client
}

func TestProvisionAccountsSendsAuditAndDecodesCredentials(t *testing.T) {
	t.Parallel()
	client := newTestAccountsClient(t, func(writer http.ResponseWriter, request *http.Request) {
		var body map[string]any
		if request.URL.Path != "/v1/internal/accounts" || json.NewDecoder(request.Body).Decode(&body) != nil ||
			body["actor_id"] != testAudit.ActorID || body["request_id"] != testAudit.RequestID {
			http.Error(writer, "unexpected request", http.StatusTeapot)
			return
		}
		writer.WriteHeader(http.StatusCreated)
		_, _ = writer.Write([]byte(`{"accounts":[{"principal_id":"p1","username":"22cs001","display_name":"Asha","password":"pw"}]}`))
	})
	credentials, err := client.ProvisionAccounts(context.Background(), []app.AccountRequest{{Username: "22cs001", DisplayName: "Asha"}}, testAudit)
	if err != nil || len(credentials) != 1 || credentials[0].Password != "pw" || credentials[0].Username != "22cs001" {
		t.Fatalf("ProvisionAccounts() = %#v, %v", credentials, err)
	}
}

func TestAccountsClientPassesActionableErrorsOnly(t *testing.T) {
	t.Parallel()
	for name, scenario := range map[string]struct {
		status   int
		body     string
		wantCode apperrors.Code
	}{
		"taken username":   {status: http.StatusConflict, body: `{"code":"conflict","message":"already in use: 22cs001"}`, wantCode: apperrors.CodeConflict},
		"invalid row":      {status: http.StatusBadRequest, body: `{"code":"invalid_argument","message":"username is invalid"}`, wantCode: apperrors.CodeInvalidArgument},
		"rejected peer":    {status: http.StatusForbidden, body: `{"code":"forbidden","message":"trusted client certificate is required"}`},
		"identity failure": {status: http.StatusInternalServerError, body: `{"code":"internal","message":"x"}`},
	} {
		client := newTestAccountsClient(t, func(writer http.ResponseWriter, _ *http.Request) {
			writer.WriteHeader(scenario.status)
			_, _ = writer.Write([]byte(scenario.body))
		})
		err := client.SetAccountStatus(context.Background(), []string{"p1"}, "disabled", testAudit)
		var domainError *apperrors.Error
		isDomain := errors.As(err, &domainError)
		if err == nil || isDomain != (scenario.wantCode != "") || (isDomain && domainError.Code != scenario.wantCode) {
			t.Fatalf("%s: error = %#v, want code %q", name, err, scenario.wantCode)
		}
	}
}
