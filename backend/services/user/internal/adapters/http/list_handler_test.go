package httpadapter

import (
	"context"
	"encoding/base64"
	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/httpauth"
	authzv1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/authz/v1"
	"google.golang.org/grpc"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListRequestPartsRejectsInvalidLimit(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c224001/students?limit=101", nil)
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c224001")

	_, _, _, err := listRequestParts(request)

	if err == nil {
		t.Fatal("listRequestParts() accepted limit=101, want error")
	}
}

func TestListRequestPartsRejectsMalformedCursor(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c224001/students?cursor=!!!", nil)
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c224001")

	_, _, _, err := listRequestParts(request)

	if err == nil {
		t.Fatal("listRequestParts() accepted malformed cursor, want error")
	}
}

func TestListRequestPartsAcceptsValidInput(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c224001/students?limit=50", nil)
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c224001")

	tenantID, limit, cursor, err := listRequestParts(request)

	if err != nil {
		t.Fatalf("listRequestParts() unexpected error: %v", err)
	}
	if tenantID != "018f4b0d-08f8-7c09-9ba7-efdf9c224001" {
		t.Errorf("tenantID = %q, want 018f4b0d-08f8-7c09-9ba7-efdf9c224001", tenantID)
	}
	if limit != 50 {
		t.Errorf("limit = %d, want 50", limit)
	}
	if cursor.SortValue != "" || cursor.ID != "" {
		t.Errorf("cursor = %+v, want empty cursor", cursor)
	}
}

func TestListRequestPartsRejectsMissingTenant(t *testing.T) {
	t.Parallel()
	// No path value set: ParseUUIDPathValue should return an error for empty string.
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/not-a-uuid/students", nil)
	request.SetPathValue("tenant_id", "not-a-uuid")

	_, _, _, err := listRequestParts(request)

	if err == nil {
		t.Fatal("listRequestParts() accepted non-UUID tenant_id, want error")
	}
}

func TestGlobalRoleAssignmentListUsesCollectionResource(t *testing.T) {
	rpc := &recordingRoleListAuthorization{}
	client, err := centralauthz.NewClient(rpc)
	if err != nil {
		t.Fatal(err)
	}
	authorizer, err := httpauth.New(client, "user")
	if err != nil {
		t.Fatal(err)
	}
	handler := &Handler{authorizer: authorizer}
	request := httptest.NewRequest(http.MethodGet, "/v1/role-assignments", nil)
	claims := base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"018f4b0d-08f8-7c09-9ba7-efdf9c223355"}`))
	request.Header.Set("Authorization", "Bearer e30."+claims+".signature")
	handler.listRoleAssignments(httptest.NewRecorder(), request)
	if rpc.request == nil {
		t.Fatal("authorization was not called")
	}
	if got := rpc.request.GetResourceId(); got != "all" {
		t.Fatalf("resource ID = %q, want all", got)
	}
	if rpc.request.GetTenantId() != "" {
		t.Fatal("global request unexpectedly has tenant")
	}
}

type recordingRoleListAuthorization struct{ request *authzv1.AuthorizeRequest }

func (rpc *recordingRoleListAuthorization) Authorize(_ context.Context, req *authzv1.AuthorizeRequest, _ ...grpc.CallOption) (*authzv1.AuthorizeResponse, error) {
	rpc.request = req
	return &authzv1.AuthorizeResponse{Allowed: false}, nil
}
