package httpadapter

import (
	"net/http"

	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/services/question-bank/internal/app"
)

type templatesRequest struct {
	Templates app.CodeTemplates `json:"templates"`
}

// getTemplates is the author's view of a version's stubs and wrappers (ADR-0063).
func (handler *Handler) getTemplates(writer http.ResponseWriter, request *http.Request) {
	versionID, err := httpx.ParseUUIDPathValue(request, "question_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "question_versions", versionID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	templates, err := handler.service.GetTemplates(request.Context(), decision.Capability, versionID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, map[string]any{"templates": templates})
}

func (handler *Handler) setTemplates(writer http.ResponseWriter, request *http.Request) {
	versionID, err := httpx.ParseUUIDPathValue(request, "question_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body templatesRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "question_versions", versionID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.SetTemplates(request.Context(), decision.Capability, versionID, body.Templates); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, map[string]any{"templates": body.Templates})
}
