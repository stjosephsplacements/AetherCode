package httpadapter

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/aethercode/aethercode/libs/pkg/httpauth"
	"github.com/aethercode/aethercode/services/seb/internal/app"
)

type fakeSEBService struct {
	validation          app.ValidationResult
	validationCommand   app.ValidateSessionHeader
	createCommand       app.CreateConfiguration
	rotateCommand       app.RotateConfiguration
	revokeCommand       app.RevokeConfiguration
	issueCommand        app.IssueSession
	closeCommand        app.CloseSession
	configurationResult app.Configuration
	sessionResult       app.Session
	issuedResult        app.IssuedSession
	mutationCalls       int
}

func (service *fakeSEBService) CreateConfiguration(_ context.Context, _ centralauthz.Capability, command app.CreateConfiguration) (app.Configuration, error) {
	service.mutationCalls++
	service.createCommand = command
	return service.configurationResult, nil
}
func (service *fakeSEBService) GetConfiguration(context.Context, centralauthz.Capability, string, string) (app.Configuration, error) {
	panic("unexpected GetConfiguration")
}
func (service *fakeSEBService) RotateConfiguration(_ context.Context, _ centralauthz.Capability, command app.RotateConfiguration) (app.Configuration, error) {
	service.mutationCalls++
	service.rotateCommand = command
	return service.configurationResult, nil
}
func (service *fakeSEBService) RevokeConfiguration(_ context.Context, _ centralauthz.Capability, command app.RevokeConfiguration) (app.Configuration, error) {
	service.mutationCalls++
	service.revokeCommand = command
	return service.configurationResult, nil
}
func (service *fakeSEBService) IssueSession(_ context.Context, _ centralauthz.Capability, command app.IssueSession) (app.IssuedSession, error) {
	service.mutationCalls++
	service.issueCommand = command
	return service.issuedResult, nil
}
func (service *fakeSEBService) GetSession(context.Context, centralauthz.Capability, string, string) (app.Session, error) {
	panic("unexpected GetSession")
}
func (service *fakeSEBService) CloseSession(_ context.Context, _ centralauthz.Capability, command app.CloseSession) (app.Session, error) {
	service.mutationCalls++
	service.closeCommand = command
	return service.sessionResult, nil
}
func (service *fakeSEBService) ValidateSessionHeader(_ context.Context, _ centralauthz.Capability, command app.ValidateSessionHeader) (app.ValidationResult, error) {
	service.validationCommand = command
	return service.validation, nil
}
func (service *fakeSEBService) ListSessions(context.Context, centralauthz.Capability, app.ListSessions) (app.Page[app.Session], error) {
	return app.Page[app.Session]{Items: []app.Session{}}, nil
}
func (service *fakeSEBService) ListConfigurations(context.Context, centralauthz.Capability, app.ListConfigurations) (app.Page[app.Configuration], error) {
	return app.Page[app.Configuration]{Items: []app.Configuration{}}, nil
}
func (service *fakeSEBService) DeleteConfiguration(context.Context, centralauthz.Capability, app.DeleteConfiguration) error {
	return nil
}
func (service *fakeSEBService) HardDeleteConfiguration(context.Context, centralauthz.Capability, app.DeleteConfiguration) error {
	return nil
}
func (service *fakeSEBService) GetConfigurationPayload(context.Context, centralauthz.Capability, app.GetConfigurationPayload) ([]byte, error) {
	panic("unexpected GetConfigurationPayload")
}

type fakeAuthorizer struct {
	selfCalls   int
	regularCall int
}

func (authorizer *fakeAuthorizer) AuthorizeHTTP(context.Context, *http.Request, string, string, string, string) (httpauth.Decision, error) {
	authorizer.regularCall++
	return httpauth.Decision{}, nil
}
func (authorizer *fakeAuthorizer) AuthorizeSelfHTTP(context.Context, *http.Request, string, string, string) (httpauth.Decision, error) {
	authorizer.selfCalls++
	return httpauth.Decision{}, nil
}

func TestValidateSessionUsesSelfAuthorizationAndDoesNotReturnSessionMetadata(t *testing.T) {
	service := &fakeSEBService{validation: app.ValidationResult{
		SessionID:        "11111111-1111-4111-8111-111111111111",
		ConfigurationID:  "22222222-2222-4222-8222-222222222222",
		AttemptID:        "33333333-3333-4333-8333-333333333333",
		HeaderKind:       "config_key",
		ValidationResult: "matched",
		OccurredAt:       time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
	}}
	authorizer := &fakeAuthorizer{}
	handler, err := NewHandler("seb", service, func(context.Context) error { return nil }, authorizer)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost,
		"/v1/tenants/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/sessions/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/validate",
		strings.NewReader(`{"header_kind":"config_key","header_value":"raw-value","request_fingerprint_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if authorizer.selfCalls != 1 || authorizer.regularCall != 0 {
		t.Fatalf("self calls = %d, regular calls = %d", authorizer.selfCalls, authorizer.regularCall)
	}
	if service.validationCommand.PresentedHeaderHash != app.HashHeaderValue("raw-value") {
		t.Fatalf("header was not hashed before application call: %q", service.validationCommand.PresentedHeaderHash)
	}
	var response map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if _, present := response["session_id"]; present {
		t.Fatalf("validation response leaks session metadata: %s", recorder.Body.String())
	}
	if response["validation_result"] != "matched" {
		t.Fatalf("unexpected response: %s", recorder.Body.String())
	}
}

func TestMutationRoutesRequireIdempotencyKeyBeforeAuthorization(t *testing.T) {
	t.Parallel()
	const tenantID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	const configurationID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	const sessionID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
	for _, testCase := range []struct {
		name string
		path string
		body string
	}{
		{"create configuration", "/v1/tenants/" + tenantID + "/configurations", `{}`},
		{"rotate configuration", "/v1/tenants/" + tenantID + "/configurations/" + configurationID + "/rotate", `{}`},
		{"revoke configuration", "/v1/tenants/" + tenantID + "/configurations/" + configurationID + "/revoke", `{}`},
		{"issue session", "/v1/tenants/" + tenantID + "/sessions", `{}`},
		{"close session", "/v1/tenants/" + tenantID + "/sessions/" + sessionID + "/close", `{}`},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			service := &fakeSEBService{}
			authorizer := &fakeAuthorizer{}
			handler, err := NewHandler("seb", service, func(context.Context) error { return nil }, authorizer)
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPost, testCase.path, strings.NewReader(testCase.body))
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()

			handler.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
			if authorizer.regularCall != 0 || authorizer.selfCalls != 0 || service.mutationCalls != 0 {
				t.Fatalf("missing key reached authorization or mutation: authz=%d self=%d mutations=%d", authorizer.regularCall, authorizer.selfCalls, service.mutationCalls)
			}
		})
	}
}

func TestCreateConfigurationPassesExactRequestChecksumAndKey(t *testing.T) {
	t.Parallel()
	service := &fakeSEBService{configurationResult: app.Configuration{ID: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"}}
	authorizer := &fakeAuthorizer{}
	handler, err := NewHandler("seb", service, func(context.Context) error { return nil }, authorizer)
	if err != nil {
		t.Fatal(err)
	}
	body := `{"exam_id":"11111111-1111-4111-8111-111111111111","exam_version_id":"22222222-2222-4222-8222-222222222222","configuration_version":1,"config_object_key":"tenant/exams/config.seb","config_checksum":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","encryption_key_reference":"kms://india/key/1","config_key_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}`
	request := httptest.NewRequest(http.MethodPost,
		"/v1/tenants/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/configurations", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", "seb-create-001")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	expectedHash, err := database.HashRequestBody([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	if service.createCommand.IdempotencyKey != "seb-create-001" || service.createCommand.RequestHash != expectedHash {
		t.Fatalf("idempotency input = key %q hash %q, want key %q hash %q", service.createCommand.IdempotencyKey, service.createCommand.RequestHash, "seb-create-001", expectedHash)
	}
	if authorizer.regularCall != 1 || service.mutationCalls != 1 {
		t.Fatalf("authorization/mutation calls = %d/%d, want 1/1", authorizer.regularCall, service.mutationCalls)
	}
}

func TestRequiredIdempotencyKeyRejectsUnsafeValues(t *testing.T) {
	t.Parallel()
	for _, value := range []string{"", " ", " leading", "trailing ", "line\nbreak", strings.Repeat("x", 256)} {
		request := httptest.NewRequest(http.MethodPost, "/", nil)
		if value != "" {
			request.Header.Set("Idempotency-Key", value)
		}
		if _, err := requiredIdempotencyKey(request); err == nil {
			t.Fatalf("requiredIdempotencyKey(%q) accepted invalid key", value)
		}
	}
	request := httptest.NewRequest(http.MethodPost, "/", nil)
	request.Header.Add("Idempotency-Key", "one")
	request.Header.Add("Idempotency-Key", "two")
	if _, err := requiredIdempotencyKey(request); err == nil {
		t.Fatal("multiple Idempotency-Key headers must be rejected")
	}
}

func TestValidateSessionRequiresGatewayFingerprint(t *testing.T) {
	service := &fakeSEBService{}
	authorizer := &fakeAuthorizer{}
	handler, err := NewHandler("seb", service, func(context.Context) error { return nil }, authorizer)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost,
		"/v1/tenants/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/sessions/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/validate",
		strings.NewReader(`{"header_kind":"config_key","header_value":"raw-value"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if authorizer.selfCalls != 0 || authorizer.regularCall != 0 {
		t.Fatal("invalid input must be rejected before central authorization")
	}
}
