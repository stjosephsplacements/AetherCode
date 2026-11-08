package httpadapter

import (
	"net/http"

	"github.com/stjosephsplacements/AetherCode/libs/pkg/database"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/httpx"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/pagination"
	"github.com/stjosephsplacements/AetherCode/services/tenant/internal/app"
)

type placementOrganizationRequest struct {
	Code      string `json:"code"`
	LegalName string `json:"legal_name"`
}

func (handler *Handler) createPlacementOrganization(writer http.ResponseWriter, request *http.Request) {
	var body placementOrganizationRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "placement_organizations", id, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	organization, err := handler.service.CreatePlacementOrganization(request.Context(), decision.Capability, app.CreatePlacementOrganization{ID: id, Code: body.Code, LegalName: body.LegalName})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, organization)
}

func (handler *Handler) getPlacementOrganization(writer http.ResponseWriter, request *http.Request) {
	organizationID, err := httpx.ParseUUIDPathValue(request, "organization_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "placement_organizations", organizationID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	organization, err := handler.service.GetPlacementOrganization(request.Context(), decision.Capability, organizationID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, organization)
}

func (handler *Handler) deletePlacementOrganization(writer http.ResponseWriter, request *http.Request) {
	organizationID, err := httpx.ParseUUIDPathValue(request, "organization_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body deleteEntityRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "placement_organizations", organizationID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.DeletePlacementOrganization(request.Context(), decision.Capability, app.DeleteEntity{ID: organizationID, ActorID: decision.PrincipalID, Reason: body.Reason}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) hardDeletePlacementOrganization(writer http.ResponseWriter, request *http.Request) {
	organizationID, err := httpx.ParseUUIDPathValue(request, "organization_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body deleteEntityRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "placement_organizations", organizationID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.HardDeletePlacementOrganization(request.Context(), decision.Capability, app.DeleteEntity{ID: organizationID, ActorID: decision.PrincipalID, Reason: body.Reason}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) listPlacementOrganizations(writer http.ResponseWriter, request *http.Request) {
	limit, err := pagination.ParseLimit(request.URL.Query().Get("limit"), 20, 100)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	cursor, _, err := pagination.Parse(request.URL.Query().Get("cursor"))
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	status, err := httpx.ParseEnumQuery(request, "status", "active", "suspended", "closed")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "placement_organizations", "all", "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListPlacementOrganizations(request.Context(), decision.Capability, app.ListPlacementOrganizations{
		Limit: limit, CursorSort: cursor.SortValue, CursorID: cursor.ID, Status: status,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

func (handler *Handler) listPlacementDepartments(writer http.ResponseWriter, request *http.Request) {
	organizationID, err := httpx.ParseUUIDPathValue(request, "organization_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	limit, err := pagination.ParseLimit(request.URL.Query().Get("limit"), 20, 100)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	cursor, _, err := pagination.Parse(request.URL.Query().Get("cursor"))
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	status, err := httpx.ParseEnumQuery(request, "status", "active", "archived")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "placement_organizations", organizationID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListPlacementDepartments(request.Context(), decision.Capability, app.ListPlacementDepartments{
		OrganizationID: organizationID, Limit: limit, CursorSort: cursor.SortValue, CursorID: cursor.ID, Status: status,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

func (handler *Handler) createPlacementDepartment(writer http.ResponseWriter, request *http.Request) {
	organizationID, err := httpx.ParseUUIDPathValue(request, "organization_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body departmentRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "placement_organizations", organizationID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	department, err := handler.service.CreatePlacementDepartment(request.Context(), decision.Capability, app.CreatePlacementDepartment{ID: id, PlacementOrganizationID: organizationID, Code: body.Code, Name: body.Name})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, department)
}

type updatePlacementOrganizationRequest struct {
	LegalName *string `json:"legal_name"`
}

func (handler *Handler) updatePlacementOrganization(writer http.ResponseWriter, request *http.Request) {
	organizationID, err := httpx.ParseUUIDPathValue(request, "organization_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body updatePlacementOrganizationRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "placement_organizations", organizationID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	organization, err := handler.service.UpdatePlacementOrganization(request.Context(), decision.Capability, app.UpdatePlacementOrganization{ID: organizationID, LegalName: body.LegalName})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, organization)
}
