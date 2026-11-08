package httpadapter

import (
	"net/http"

	"github.com/stjosephsplacements/AetherCode/libs/pkg/httpauth"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/httpx"
	"github.com/stjosephsplacements/AetherCode/services/question-bank/internal/app"
)

func (handler *Handler) authorizePractice(request *http.Request, action string) (httpauth.Decision, error) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		return httpauth.Decision{}, err
	}
	return handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, action, "practice_submissions", tenantID)
}

func (handler *Handler) writePractice(writer http.ResponseWriter, status int, value any, err error) {
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(writer, status, value)
}

func (handler *Handler) listPracticeQuestions(writer http.ResponseWriter, request *http.Request) {
	decision, err := handler.authorizePractice(request, "read")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	questions, err := handler.service.ListPracticeQuestions(request.Context(), decision.Capability)
	handler.writePractice(writer, http.StatusOK, questions, err)
}

func (handler *Handler) getPracticeProgress(writer http.ResponseWriter, request *http.Request) {
	decision, err := handler.authorizePractice(request, "read")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	progress, err := handler.service.GetPracticeProgress(request.Context(), decision.Capability)
	handler.writePractice(writer, http.StatusOK, progress, err)
}

func (handler *Handler) getPracticeQuestion(writer http.ResponseWriter, request *http.Request) {
	questionID, err := httpx.ParseUUIDPathValue(request, "question_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizePractice(request, "read")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	question, err := handler.service.GetPracticeQuestion(request.Context(), decision.Capability, questionID)
	handler.writePractice(writer, http.StatusOK, question, err)
}

func (handler *Handler) listPracticeSubmissions(writer http.ResponseWriter, request *http.Request) {
	questionID, err := httpx.ParseUUIDPathValue(request, "question_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizePractice(request, "read")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	submissions, err := handler.service.ListPracticeSubmissions(request.Context(), decision.Capability, questionID)
	handler.writePractice(writer, http.StatusOK, submissions, err)
}

func (handler *Handler) getPracticeSubmission(writer http.ResponseWriter, request *http.Request) {
	submissionID, err := httpx.ParseUUIDPathValue(request, "submission_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizePractice(request, "read")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	submission, err := handler.service.GetPracticeSubmission(request.Context(), decision.Capability, submissionID)
	handler.writePractice(writer, http.StatusOK, submission, err)
}

type practiceRequest struct {
	Language string  `json:"language"`
	Mode     string  `json:"mode"`
	Source   string  `json:"source"`
	Input    *string `json:"input"`
}

func (handler *Handler) startPractice(writer http.ResponseWriter, request *http.Request) {
	questionID, err := httpx.ParseUUIDPathValue(request, "question_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body practiceRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizePractice(request, "write")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := handler.service.StartPractice(request.Context(), decision.Capability, app.StartPractice{
		QuestionID: questionID, Language: body.Language, Mode: body.Mode, Source: body.Source, Input: body.Input,
	})
	handler.writePractice(writer, http.StatusAccepted, map[string]string{"id": id}, err)
}
