package httpadapter

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/stjosephsplacements/AetherCode/libs/pkg/database"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/httpx"
	"github.com/stjosephsplacements/AetherCode/services/tenant/internal/app"
	"github.com/stjosephsplacements/AetherCode/services/tenant/internal/domain/branding"
)

// platformBrandingID is the fixed resource id for the platform-default branding row (nil tenant_id).
const platformBrandingID = "00000000-0000-4000-8000-0000000000bf"

type brandingPayload struct {
	AppName     string  `json:"app_name"`
	AccentColor *string `json:"accent_color"`
}

type brandingOrderRequest struct {
	LogoIDs []string `json:"logo_ids"`
}

func (handler *Handler) getPublicBranding(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := optionalTenantQuery(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	view, err := handler.service.PublicBranding(request.Context(), tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, view)
}

func (handler *Handler) getPublicBrandingLogo(writer http.ResponseWriter, request *http.Request) {
	logoID, err := httpx.ParseUUIDPathValue(request, "logo_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	data, contentType, err := handler.service.BrandingLogoContent(request.Context(), logoID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.Header().Set("Content-Type", contentType)
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	if contentType == "image/svg+xml" {
		writer.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	}
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write(data)
}

func (handler *Handler) getPlatformBranding(writer http.ResponseWriter, request *http.Request) {
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "branding", platformBrandingID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	view, err := handler.service.GetBranding(request.Context(), decision.Capability, nil)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, view)
}

func (handler *Handler) putPlatformBranding(writer http.ResponseWriter, request *http.Request) {
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "branding", platformBrandingID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	body, err := decodeBrandingBody(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	accent := body.accentColor
	view, err := handler.service.UpsertBranding(request.Context(), decision.Capability, app.UpsertBranding{
		TenantID: nil, AppName: body.AppName, AccentColor: accentPointer(accent), UpdatedBy: decision.PrincipalID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, view)
}

func (handler *Handler) getTenantBranding(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "branding", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id := tenantID
	view, err := handler.service.GetBranding(request.Context(), decision.Capability, &id)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, view)
}

func (handler *Handler) putTenantBranding(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "branding", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	body, err := decodeBrandingBody(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id := tenantID
	accent := body.accentColor
	view, err := handler.service.UpsertBranding(request.Context(), decision.Capability, app.UpsertBranding{
		TenantID: &id, AppName: body.AppName, AccentColor: accentPointer(accent), UpdatedBy: decision.PrincipalID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, view)
}

func (handler *Handler) postPlatformBrandingLogo(writer http.ResponseWriter, request *http.Request) {
	handler.uploadBrandingLogo(writer, request, nil)
}

func (handler *Handler) postTenantBrandingLogo(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id := tenantID
	handler.uploadBrandingLogo(writer, request, &id)
}

func (handler *Handler) uploadBrandingLogo(writer http.ResponseWriter, request *http.Request, tenantID *string) {
	resourceID := platformBrandingID
	tenantScope := ""
	if tenantID != nil {
		resourceID = *tenantID
		tenantScope = *tenantID
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "branding", resourceID, tenantScope)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := request.ParseMultipartForm(branding.MaxLogoBytes + (1 << 10)); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	file, header, err := request.FormFile("logo")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, branding.MaxLogoBytes+1))
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if len(data) > branding.MaxLogoBytes {
		httpx.WriteError(writer, fmt.Errorf("logo must be at most 1 MB"))
		return
	}
	logoID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	contentType := header.Header.Get("Content-Type")
	altText := strings.TrimSpace(request.FormValue("alt_text"))
	view, err := handler.service.UploadBrandingLogo(request.Context(), decision.Capability, app.UploadBrandingLogo{
		TenantID: tenantID, LogoID: logoID, AltText: altText, ContentType: contentType, Data: data, UpdatedBy: decision.PrincipalID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, view)
}

func (handler *Handler) putPlatformBrandingLogoOrder(writer http.ResponseWriter, request *http.Request) {
	handler.reorderBrandingLogos(writer, request, nil)
}

func (handler *Handler) putTenantBrandingLogoOrder(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id := tenantID
	handler.reorderBrandingLogos(writer, request, &id)
}

func (handler *Handler) reorderBrandingLogos(writer http.ResponseWriter, request *http.Request, tenantID *string) {
	resourceID := platformBrandingID
	tenantScope := ""
	if tenantID != nil {
		resourceID = *tenantID
		tenantScope = *tenantID
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "branding", resourceID, tenantScope)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body brandingOrderRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	view, err := handler.service.ReorderBrandingLogos(request.Context(), decision.Capability, app.ReorderBrandingLogos{
		TenantID: tenantID, LogoIDs: body.LogoIDs,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, view)
}

func (handler *Handler) deletePlatformBrandingLogo(writer http.ResponseWriter, request *http.Request) {
	handler.deleteBrandingLogo(writer, request, nil)
}

func (handler *Handler) deleteTenantBrandingLogo(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id := tenantID
	handler.deleteBrandingLogo(writer, request, &id)
}

func (handler *Handler) deleteBrandingLogo(writer http.ResponseWriter, request *http.Request, tenantID *string) {
	logoID, err := httpx.ParseUUIDPathValue(request, "logo_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	resourceID := platformBrandingID
	tenantScope := ""
	if tenantID != nil {
		resourceID = *tenantID
		tenantScope = *tenantID
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "branding", resourceID, tenantScope)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	view, err := handler.service.DeleteBrandingLogo(request.Context(), decision.Capability, app.DeleteBrandingLogo{
		TenantID: tenantID, LogoID: logoID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, view)
}

func optionalTenantQuery(request *http.Request) (*string, error) {
	raw := strings.TrimSpace(request.URL.Query().Get("tenant_id"))
	if raw == "" {
		return nil, nil
	}
	if _, err := httpx.ParseUUIDValue("tenant_id", raw); err != nil {
		return nil, err
	}
	return &raw, nil
}

func decodeBrandingBody(request *http.Request) (decodedBrandingBody, error) {
	var body brandingPayload
	if err := httpx.DecodeJSON(request, &body); err != nil {
		return decodedBrandingBody{}, err
	}
	accent := ""
	if body.AccentColor != nil {
		accent = *body.AccentColor
	}
	return decodedBrandingBody{AppName: strings.TrimSpace(body.AppName), accentColor: accent}, nil
}

type decodedBrandingBody struct {
	AppName     string
	accentColor string
}

func accentPointer(color string) *string {
	if strings.TrimSpace(color) == "" {
		return nil
	}
	value := strings.ToLower(strings.TrimSpace(color))
	return &value
}