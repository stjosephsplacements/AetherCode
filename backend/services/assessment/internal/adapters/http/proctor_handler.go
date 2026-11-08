package httpadapter

import (
	"encoding/json"
	"net/http"

	"github.com/stjosephsplacements/AetherCode/libs/pkg/database"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/httpx"
	"github.com/stjosephsplacements/AetherCode/services/assessment/internal/app"
)

type createProctorPolicyRequest struct {
	Name string `json:"name"`
}

func (handler *Handler) createProctorPolicy(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body createProctorPolicyRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "proctor_policies", id, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	policy, err := handler.service.CreateProctorPolicy(request.Context(), decision.Capability, app.CreateProctorPolicy{WriteCommand: app.WriteCommand{IdempotencyKey: key}, ID: id, TenantID: tenantID, Name: body.Name})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, policy)
}

type createProctorPolicyVersionRequest struct {
	ExpectedPolicyVersion int64           `json:"expected_policy_version"`
	Policy                json.RawMessage `json:"policy"`
}

func (handler *Handler) createProctorPolicyVersion(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	proctorPolicyID, err := httpx.ParseUUIDPathValue(request, "proctor_policy_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body createProctorPolicyVersionRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "proctor_policy_versions", id, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	policyVersion, err := handler.service.CreateProctorPolicyVersion(request.Context(), decision.Capability, app.CreateProctorPolicyVersion{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, ID: id, TenantID: tenantID, ProctorPolicyID: proctorPolicyID,
		ExpectedPolicyVersion: body.ExpectedPolicyVersion, Policy: body.Policy,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, policyVersion)
}

func (handler *Handler) publishProctorPolicyVersion(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	versionID, err := httpx.ParseUUIDPathValue(request, "proctor_policy_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "proctor_policy_versions", versionID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	policyVersion, err := handler.service.PublishProctorPolicyVersion(request.Context(), decision.Capability, app.PublishProctorPolicyVersion{WriteCommand: app.WriteCommand{IdempotencyKey: key}, TenantID: tenantID, ProctorPolicyVersionID: versionID})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, policyVersion)
}

func (handler *Handler) getProctorPolicy(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	policyID, err := httpx.ParseUUIDPathValue(request, "proctor_policy_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "proctor_policies", policyID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	policy, err := handler.service.GetProctorPolicy(request.Context(), decision.Capability, tenantID, policyID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, policy)
}

func (handler *Handler) getProctorPolicyVersion(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := tenantID(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	versionID, err := httpx.ParseUUIDPathValue(request, "proctor_policy_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "proctor_policy_versions", versionID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	policyVersion, err := handler.service.GetProctorPolicyVersion(request.Context(), decision.Capability, tenantID, versionID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, policyVersion)
}

func (handler *Handler) listProctorPolicies(writer http.ResponseWriter, request *http.Request) {
	tenantID, limit, cursor, err := listRequestParts(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	lifecycleState, err := httpx.ParseEnumQuery(request, "lifecycle_state",
		"draft", "active", "archived")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "proctor_policies", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListProctorPolicies(request.Context(), decision.Capability, app.ListProctorPolicies{
		TenantID:       tenantID,
		Limit:          limit,
		CursorSort:     cursor.SortValue,
		CursorID:       cursor.ID,
		LifecycleState: lifecycleState,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

func (handler *Handler) listProctorPolicyVersions(writer http.ResponseWriter, request *http.Request) {
	tenantID, limit, cursor, err := listRequestParts(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	policyID, err := httpx.ParseUUIDPathValue(request, "proctor_policy_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	status, err := httpx.ParseEnumQuery(request, "status", "draft", "published")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "proctor_policy_versions", policyID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListProctorPolicyVersions(request.Context(), decision.Capability, app.ListProctorPolicyVersions{
		TenantID:        tenantID,
		ProctorPolicyID: policyID,
		Limit:           limit,
		CursorSort:      cursor.SortValue,
		CursorID:        cursor.ID,
		Status:          status,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}
