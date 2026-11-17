package httpadapter

import (
	"net/http"
	"strconv"

	"github.com/stjosephsplacements/AetherCode/libs/pkg/httpx"
	"github.com/stjosephsplacements/AetherCode/services/seb/internal/app"
)

type examPolicyRequest struct {
	Title           string   `json:"title"`
	Enabled         bool     `json:"enabled"`
	AcceptedKeys    []string `json:"accepted_keys"`
	AllowedNetworks []string `json:"allowed_networks"`
}

func (handler *Handler) putExamPolicy(writer http.ResponseWriter, request *http.Request) {
	tenantID, examID, err := tenantAndResourceID(request, "exam_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body examPolicyRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "configurations", examID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	policy, err := handler.service.PutExamPolicy(request.Context(), decision.Capability, app.PutExamPolicy{
		TenantID: tenantID, ExamID: examID, Title: body.Title, Enabled: body.Enabled,
		AcceptedKeys: body.AcceptedKeys, AllowedNetworks: body.AllowedNetworks, ActorID: decision.PrincipalID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, policy)
}

func (handler *Handler) getExamPolicy(writer http.ResponseWriter, request *http.Request) {
	tenantID, examID, err := tenantAndResourceID(request, "exam_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "configurations", examID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	policy, err := handler.service.GetExamPolicy(request.Context(), decision.Capability, tenantID, examID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(writer, http.StatusOK, policy)
}

func (handler *Handler) getStaffLaunchFile(writer http.ResponseWriter, request *http.Request) {
	tenantID, examID, err := tenantAndResourceID(request, "exam_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "configurations", examID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	file, err := handler.service.StaffLaunchFile(request.Context(), decision.Capability, tenantID, examID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writeLaunchFile(writer, file)
}

// getCandidateLaunchFile is candidate-self: the database binds the signed
// actor to an open assignment of the exam.
func (handler *Handler) getCandidateLaunchFile(writer http.ResponseWriter, request *http.Request) {
	tenantID, examID, err := tenantAndResourceID(request, "exam_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	// Safe Exam Browser fetches a sebs:// link with no session, so a ticket from
	// issueLaunchTicket stands in for the bearer, once.
	if ticket := request.URL.Query().Get("ticket"); ticket != "" {
		file, err := handler.service.TicketLaunchFile(request.Context(), tenantID, examID, ticket)
		if err != nil {
			httpx.WriteError(writer, err)
			return
		}
		writeLaunchFile(writer, file)
		return
	}
	decision, err := handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, "read", "sessions", tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	file, err := handler.service.CandidateLaunchFile(request.Context(), decision.Capability, tenantID, examID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writeLaunchFile(writer, file)
}

// issueLaunchTicket mints the one-time ticket behind the one-click sebs:// launch. It is
// candidate-self, and the database checks the candidate holds an open assignment to the exam.
func (handler *Handler) issueLaunchTicket(writer http.ResponseWriter, request *http.Request) {
	tenantID, examID, err := tenantAndResourceID(request, "exam_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, "read", "sessions", tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	ticket, err := handler.service.IssueLaunchTicket(request.Context(), decision.Capability, tenantID, examID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(writer, http.StatusCreated, map[string]any{"ticket": ticket, "expires_in": int(app.LaunchTicketTTL.Seconds())})
}

// writeLaunchFile sends the .seb file as the exam app does: the file is
// itself gzip data, so Content-Encoding says identity and no proxy or
// browser unpacks it before it is saved.
func writeLaunchFile(writer http.ResponseWriter, file app.LaunchFile) {
	writer.Header().Set("Content-Type", "application/seb")
	writer.Header().Set("Content-Disposition", `attachment; filename="`+file.Filename+`"`)
	writer.Header().Set("Content-Encoding", "identity")
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("Content-Length", strconv.Itoa(len(file.Content)))
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write(file.Content)
}

type requestCheckRequest struct {
	URL           string `json:"url"`
	RequestHash   string `json:"request_hash"`
	ConfigKeyHash string `json:"config_key_hash"`
	ClientIP      string `json:"client_ip"`
}

// checkRequest is Gateway's per-request lockdown check for the bearer. It
// authorizes a self read, which students, mentors and staff all hold, so the
// check never locks a read-only role out of protected routes; the database
// binds the signed actor to their own assignments.
func (handler *Handler) checkRequest(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body requestCheckRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, "read", "sessions", tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	result, err := handler.service.CheckExamRequest(request.Context(), decision.Capability, app.CheckExamRequest{
		TenantID: tenantID, URL: body.URL, RequestHash: body.RequestHash, ConfigKeyHash: body.ConfigKeyHash, ClientIP: body.ClientIP,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(writer, http.StatusOK, struct {
		Result string `json:"result"`
	}{result})
}
