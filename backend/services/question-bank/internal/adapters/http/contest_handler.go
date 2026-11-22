package httpadapter

import (
	"encoding/json"
	"net/http"
	"time"

	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/httpx"
	"github.com/stjosephsplacements/AetherCode/services/question-bank/internal/app"
)

func (handler *Handler) listCollegeContests(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "college_contests", tenantID, tenantID)
	if err != nil {
		decision, err = handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, "read", "college_contests", tenantID)
	}
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	raw, err := handler.service.ListCollegeContests(request.Context(), decision.Capability, tenantID)
	handler.writePractice(writer, http.StatusOK, json.RawMessage(raw), err)
}

func (handler *Handler) createCollegeContest(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "college_contests", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body struct {
		Title       string   `json:"title"`
		Description string   `json:"description"`
		StartsAt    string   `json:"starts_at"`
		EndsAt      string   `json:"ends_at"`
		QuestionIDs []string `json:"question_ids"`
	}
	if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	startsAt, err := time.Parse(time.RFC3339, body.StartsAt)
	if err != nil {
		httpx.WriteError(writer, apperrors.New(apperrors.CodeInvalidArgument, "starts_at must be RFC3339"))
		return
	}
	endsAt, err := time.Parse(time.RFC3339, body.EndsAt)
	if err != nil {
		httpx.WriteError(writer, apperrors.New(apperrors.CodeInvalidArgument, "ends_at must be RFC3339"))
		return
	}
	raw, err := handler.service.SaveCollegeContest(request.Context(), decision.Capability, tenantID, app.SaveCollegeContest{
		Title: body.Title, Description: body.Description, StartsAt: startsAt, EndsAt: endsAt, QuestionIDs: body.QuestionIDs,
	})
	handler.writePractice(writer, http.StatusCreated, json.RawMessage(raw), err)
}

func (handler *Handler) registerCollegeContest(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	contestID, err := httpx.ParseUUIDPathValue(request, "contest_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, "write", "practice_submissions", tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	raw, err := handler.service.RegisterCollegeContest(request.Context(), decision.Capability, tenantID, contestID)
	handler.writePractice(writer, http.StatusOK, json.RawMessage(raw), err)
}

func (handler *Handler) collegeContestLeaderboard(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	contestID, err := httpx.ParseUUIDPathValue(request, "contest_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "college_contests", tenantID, tenantID)
	if err != nil {
		decision, err = handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, "read", "college_contests", tenantID)
	}
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	raw, err := handler.service.CollegeContestLeaderboard(request.Context(), decision.Capability, tenantID, contestID)
	handler.writePractice(writer, http.StatusOK, json.RawMessage(raw), err)
}
