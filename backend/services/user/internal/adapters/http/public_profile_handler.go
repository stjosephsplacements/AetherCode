package httpadapter

import (
	"net/http"

	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/services/user/internal/app"
)

type publicProfileRequest struct {
	Slug    string                   `json:"slug"`
	Enabled bool                     `json:"enabled"`
	Content app.PublicProfileContent `json:"content"`
}

// getOwnPublicProfile is the caller's own settings; a self role reaches only its own principal.
func (handler *Handler) getOwnPublicProfile(writer http.ResponseWriter, request *http.Request) {
	principalID, err := httpx.ParseUUIDPathValue(request, "principal_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	tenantID, err := requiredTenantQuery(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "profiles", principalID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	profile, err := handler.publicProfiles.Own(request.Context(), decision.Capability, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, profile)
}

func (handler *Handler) setOwnPublicProfile(writer http.ResponseWriter, request *http.Request) {
	principalID, err := httpx.ParseUUIDPathValue(request, "principal_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	tenantID, err := requiredTenantQuery(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body publicProfileRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "profiles", principalID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	profile, err := handler.publicProfiles.Set(request.Context(), decision.Capability, tenantID, app.SetPublicProfile{Slug: body.Slug, Enabled: body.Enabled, Content: body.Content})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, profile)
}

// getPublicProfile needs no sign-in: the gateway lets this one route through anonymously.
func (handler *Handler) getPublicProfile(writer http.ResponseWriter, request *http.Request) {
	profile, err := handler.publicProfiles.BySlug(request.Context(), request.PathValue("slug"))
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.Header().Set("Cache-Control", "public, max-age=60")
	httpx.WriteJSON(writer, http.StatusOK, profile)
}
