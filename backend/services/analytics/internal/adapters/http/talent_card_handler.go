package httpadapter

import (
	"net/http"

	"github.com/stjosephsplacements/AetherCode/libs/pkg/httpx"
	"github.com/stjosephsplacements/AetherCode/services/analytics/internal/app"
)

func (handler *Handler) getTalentCardConsent(writer http.ResponseWriter, request *http.Request) {
	tenantID, studentID, err := tenantAndStudent(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	// The student is their own resource: the bearer subject must equal studentID.
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "talent_card_consents", studentID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	consent, err := handler.talent.GetConsent(request.Context(), decision.Capability, tenantID, studentID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, consent)
}

func (handler *Handler) setTalentCardConsent(writer http.ResponseWriter, request *http.Request) {
	tenantID, studentID, err := tenantAndStudent(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body app.TalentCardConsent
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	// Contact sharing needs the card itself to be agreed to; store and echo the same value.
	body.ShareContactInfo = body.ShareContactInfo && body.Granted
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "talent_card_consents", studentID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.talent.SetConsent(request.Context(), decision.Capability, tenantID, studentID, body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, body)
}

func (handler *Handler) issueTalentCard(writer http.ResponseWriter, request *http.Request) {
	tenantID, studentID, err := tenantAndStudent(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var identity app.TalentCardIdentity
	if err := httpx.DecodeJSON(request, &identity); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "talent_cards", studentID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	card, err := handler.talent.Issue(request.Context(), decision.Capability, tenantID, studentID, identity)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(writer, http.StatusCreated, card)
}

func (handler *Handler) revokeTalentCard(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	cardID, err := httpx.ParseUUIDPathValue(request, "card_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "talent_cards", cardID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.talent.Revoke(request.Context(), decision.Capability, tenantID, cardID); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

// verifyTalentCard needs no sign-in: the gateway lets this one route through
// anonymously. It returns only the signed claims, never student records.
func (handler *Handler) verifyTalentCard(writer http.ResponseWriter, request *http.Request) {
	claims, err := handler.talent.Verify(request.Context(), request.PathValue("token"))
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(writer, http.StatusOK, claims)
}

func tenantAndStudent(request *http.Request) (tenantID, studentID string, err error) {
	if tenantID, err = httpx.ParseUUIDPathValue(request, "tenant_id"); err != nil {
		return "", "", err
	}
	studentID, err = httpx.ParseUUIDPathValue(request, "student_id")
	return tenantID, studentID, err
}
