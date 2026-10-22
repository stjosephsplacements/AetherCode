// Package httpadapter exposes Question Bank's protected authoring API.
package httpadapter

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/evalbundle"
	"github.com/aethercode/aethercode/libs/pkg/httpauth"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/libs/pkg/pagination"
	"github.com/aethercode/aethercode/services/question-bank/internal/app"
)

type Handler struct {
	service    *app.Service
	authorizer *httpauth.Authorizer
}

func NewHandler(serviceName string, service *app.Service, readiness httpx.ReadinessFunc, authorizer *httpauth.Authorizer) (http.Handler, error) {
	if service == nil || authorizer == nil {
		return nil, fmt.Errorf("question-bank service and authorizer are required")
	}
	handler := &Handler{service: service, authorizer: authorizer}
	mux := httpx.NewOperationalMux(serviceName, readiness)
	mux.HandleFunc("GET /v1/questions", handler.listPublishedQuestions)
	mux.HandleFunc("POST /v1/questions", handler.createQuestion)
	mux.HandleFunc("GET /v1/questions/{question_id}", handler.getPublishedQuestion)
	mux.HandleFunc("GET /v1/questions/{question_id}/versions", handler.listQuestionVersions)
	mux.HandleFunc("POST /v1/questions/{question_id}/versions", handler.createDraftQuestionVersion)
	mux.HandleFunc("POST /v1/questions/{question_id}/archive", handler.archiveQuestion)
	mux.HandleFunc("GET /v1/question-versions/{question_version_id}", handler.getQuestionVersion)
	mux.HandleFunc("GET /v1/question-versions/{question_version_id}/export", handler.exportQuestionVersion)
	mux.HandleFunc("PUT /v1/question-versions/{question_version_id}/choices", handler.setQuestionVersionChoices)
	mux.HandleFunc("POST /v1/question-versions/{question_version_id}/model-checks", handler.startModelCheck)
	mux.HandleFunc("GET /v1/question-versions/{question_version_id}/model-checks", handler.listModelChecks)
	mux.HandleFunc("PUT /v1/question-versions/{question_version_id}/tests", handler.setQuestionVersionTests)
	mux.HandleFunc("POST /v1/question-versions/{question_version_id}/assets", handler.addQuestionAsset)
	mux.HandleFunc("PUT /v1/question-versions/{question_version_id}/tags", handler.replaceQuestionVersionTags)
	mux.HandleFunc("POST /v1/question-versions/{question_version_id}/publish", handler.publishQuestionVersion)
	mux.HandleFunc("POST /v1/question-versions/{question_version_id}/request-review", handler.requestQuestionReview)
	mux.HandleFunc("GET /v1/review-policy", handler.reviewPolicy)
	mux.HandleFunc("DELETE /v1/questions/{question_id}", handler.deleteQuestion)
	mux.HandleFunc("DELETE /v1/questions/{question_id}/hard", handler.hardDeleteQuestion)
	mux.HandleFunc("DELETE /v1/question-versions/{question_version_id}", handler.deleteQuestionVersion)
	mux.HandleFunc("DELETE /v1/question-versions/{question_version_id}/hard", handler.hardDeleteQuestionVersion)
	mux.HandleFunc("GET /v1/question-versions/{question_version_id}/assets/{asset_kind}", handler.getAsset)
	mux.HandleFunc("PUT /v1/questions/{question_id}/audience", handler.setQuestionAudience)
	// Practice (ADR-0041): a student's own college and runs only.
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/practice/questions", handler.listPracticeQuestions)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/practice/questions/{question_id}", handler.getPracticeQuestion)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/practice/questions/{question_id}/submissions", handler.listPracticeSubmissions)
	mux.HandleFunc("POST /v1/tenants/{tenant_id}/practice/questions/{question_id}/submissions", handler.startPractice)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/practice/submissions/{submission_id}", handler.getPracticeSubmission)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/practice/progress", handler.getPracticeProgress)
	return mux, nil
}

type objectReferenceRequest struct {
	ObjectKey              string `json:"object_key"`
	Checksum               string `json:"checksum"`
	EncryptionKeyReference string `json:"encryption_key_reference"`
}

type versionContentRequest struct {
	Title              string   `json:"title"`
	PromptMarkdown     string   `json:"prompt_markdown"`
	Difficulty         string   `json:"difficulty"`
	SupportedLanguages []string `json:"supported_languages"`
	TimeLimitMS        int      `json:"time_limit_ms"`
	MemoryLimitKiB     int      `json:"memory_limit_kib"`
	Tags               []string `json:"tags"`
}

func (request versionContentRequest) commandContent() app.VersionContent {
	tags := make([]app.Tag, len(request.Tags))
	for index, name := range request.Tags {
		tags[index] = app.Tag{Name: name}
	}
	return app.VersionContent{
		Title: request.Title, PromptMarkdown: request.PromptMarkdown,
		Difficulty: request.Difficulty, SupportedLanguages: request.SupportedLanguages,
		TimeLimitMS: request.TimeLimitMS, MemoryLimitKiB: request.MemoryLimitKiB,
		Tags: tags,
	}
}

type createQuestionRequest struct {
	Slug string `json:"slug"`
	versionContentRequest
}

func (handler *Handler) createQuestion(writer http.ResponseWriter, request *http.Request) {
	var body createQuestionRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	questionID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	versionID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	eventID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "questions", questionID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	question, err := handler.service.CreateQuestion(request.Context(), decision.Capability, app.CreateQuestion{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, ID: questionID, VersionID: versionID,
		EventID: eventID, Slug: body.Slug, Content: body.commandContent(),
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, question)
}

type createDraftQuestionVersionRequest struct {
	ExpectedQuestionRevision int64 `json:"expected_question_revision"`
	versionContentRequest
}

func (handler *Handler) createDraftQuestionVersion(writer http.ResponseWriter, request *http.Request) {
	questionID, err := httpx.ParseUUIDPathValue(request, "question_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body createDraftQuestionVersionRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	versionID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	eventID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "question_versions", versionID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	question, err := handler.service.CreateDraftQuestionVersion(request.Context(), decision.Capability, app.CreateDraftQuestionVersion{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, ID: versionID, EventID: eventID,
		QuestionID: questionID, ExpectedQuestionRevision: body.ExpectedQuestionRevision,
		Content: body.commandContent(),
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, question)
}

type testRequest struct {
	Input          string `json:"input"`
	ExpectedOutput string `json:"expected_output"`
	Sample         bool   `json:"sample"`
	Weight         *int   `json:"weight"`
}

type testsRequest struct {
	ExpectedQuestionVersion int64         `json:"expected_question_version"`
	Tests                   []testRequest `json:"tests"`
}

// setQuestionVersionTests replaces every test of a draft version from plaintext.
// The body is bounded by httpx's 1 MiB JSON limit, which therefore also bounds
// the total size of all inputs and outputs. It is deliberately not
// Idempotency-Key based: expected_question_version already makes a replayed
// request fail with a conflict instead of rewriting the tests.
func (handler *Handler) setQuestionVersionTests(writer http.ResponseWriter, request *http.Request) {
	questionVersionID, err := httpx.ParseUUIDPathValue(request, "question_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body testsRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "test_case_manifests", questionVersionID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	tests := make([]app.TestCase, len(body.Tests))
	for index, test := range body.Tests {
		weight := evalbundle.DefaultWeight
		if test.Weight != nil {
			weight = *test.Weight
		}
		tests[index] = app.TestCase{Input: test.Input, ExpectedOutput: test.ExpectedOutput, Sample: test.Sample, Weight: weight}
	}
	version, err := handler.service.SetQuestionVersionTests(request.Context(), decision.Capability, app.SetQuestionVersionTests{
		QuestionVersionID: questionVersionID, ExpectedQuestionVersion: body.ExpectedQuestionVersion, Tests: tests,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, version)
}

type assetRequest struct {
	AssetKind               string                 `json:"asset_kind"`
	ObjectReference         objectReferenceRequest `json:"object_reference"`
	ContentType             string                 `json:"content_type"`
	ByteSize                int64                  `json:"byte_size"`
	ExpectedQuestionVersion int64                  `json:"expected_question_version"`
}

func (handler *Handler) addQuestionAsset(writer http.ResponseWriter, request *http.Request) {
	questionVersionID, err := httpx.ParseUUIDPathValue(request, "question_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body assetRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	assetID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "question_assets", assetID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	version, err := handler.service.AddQuestionAsset(request.Context(), decision.Capability, app.AddQuestionAsset{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, ID: assetID,
		QuestionVersionID: questionVersionID, AssetKind: body.AssetKind,
		ObjectReference: objectReference(body.ObjectReference), ContentType: body.ContentType,
		ByteSize: body.ByteSize, ExpectedQuestionVersion: body.ExpectedQuestionVersion,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, version)
}

type tagsRequest struct {
	ExpectedQuestionVersion int64    `json:"expected_question_version"`
	Tags                    []string `json:"tags"`
}

func (handler *Handler) replaceQuestionVersionTags(writer http.ResponseWriter, request *http.Request) {
	questionVersionID, err := httpx.ParseUUIDPathValue(request, "question_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body tagsRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "question_version_tags", questionVersionID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	tags := make([]app.Tag, len(body.Tags))
	for index, name := range body.Tags {
		tags[index] = app.Tag{Name: name}
	}
	version, err := handler.service.ReplaceQuestionVersionTags(request.Context(), decision.Capability, app.ReplaceQuestionVersionTags{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, QuestionVersionID: questionVersionID,
		ExpectedQuestionVersion: body.ExpectedQuestionVersion, Tags: tags,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, version)
}

type publishQuestionVersionRequest struct {
	ExpectedQuestionVersion int64 `json:"expected_question_version"`
}

func (handler *Handler) publishQuestionVersion(writer http.ResponseWriter, request *http.Request) {
	questionVersionID, err := httpx.ParseUUIDPathValue(request, "question_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body publishQuestionVersionRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	eventID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "question_versions", questionVersionID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	question, err := handler.service.PublishQuestionVersion(request.Context(), decision.Capability, app.PublishQuestionVersion{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, QuestionVersionID: questionVersionID,
		EventID: eventID, ExpectedQuestionVersion: body.ExpectedQuestionVersion,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, question)
}

// reviewPolicy tells the staff UI whether publishing needs a review (ADR-0044).
func (handler *Handler) reviewPolicy(writer http.ResponseWriter, request *http.Request) {
	if _, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "questions", "policy", ""); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, map[string]bool{"require_review": handler.service.ReviewRequired()})
}

// requestQuestionReview asks for a review of a draft (ADR-0044).
type requestQuestionReviewRequest struct {
	ExpectedQuestionVersion int64  `json:"expected_question_version"`
	ReviewerID              string `json:"reviewer_id"`
}

func (handler *Handler) requestQuestionReview(writer http.ResponseWriter, request *http.Request) {
	questionVersionID, err := httpx.ParseUUIDPathValue(request, "question_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body requestQuestionReviewRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "question_versions", questionVersionID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	question, err := handler.service.RequestQuestionReview(request.Context(), decision.Capability, app.RequestQuestionReview{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, QuestionVersionID: questionVersionID,
		ExpectedQuestionVersion: body.ExpectedQuestionVersion, ReviewerID: body.ReviewerID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, question)
}

type archiveQuestionRequest struct {
	ExpectedQuestionRevision int64 `json:"expected_question_revision"`
}

func (handler *Handler) archiveQuestion(writer http.ResponseWriter, request *http.Request) {
	questionID, err := httpx.ParseUUIDPathValue(request, "question_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body archiveQuestionRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	eventID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "questions", questionID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	question, err := handler.service.ArchiveQuestion(request.Context(), decision.Capability, app.ArchiveQuestion{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, QuestionID: questionID,
		EventID: eventID, ExpectedQuestionRevision: body.ExpectedQuestionRevision,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, question)
}

func (handler *Handler) getPublishedQuestion(writer http.ResponseWriter, request *http.Request) {
	questionID, err := httpx.ParseUUIDPathValue(request, "question_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "questions", questionID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	question, err := handler.service.GetPublishedQuestion(request.Context(), decision.Capability, questionID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, question)
}

func (handler *Handler) getQuestionVersion(writer http.ResponseWriter, request *http.Request) {
	questionVersionID, err := httpx.ParseUUIDPathValue(request, "question_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "question_versions", questionVersionID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	version, err := handler.service.GetQuestionVersion(request.Context(), decision.Capability, questionVersionID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, version)
}

func (handler *Handler) listPublishedQuestions(writer http.ResponseWriter, request *http.Request) {
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
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "questions", "published", "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	query := request.URL.Query()
	// ?status=draft lists the caller's own drafts instead, and ?status=review
	// the drafts of every author that wait for a review (ADR-0044).
	if status := query.Get("status"); status == "draft" || status == "review" {
		list := handler.service.ListDraftQuestions
		if status == "review" {
			list = handler.service.ListReviewQueue
		}
		page, draftErr := list(request.Context(), decision.Capability, limit)
		if draftErr != nil {
			httpx.WriteError(writer, draftErr)
			return
		}
		httpx.WriteJSON(writer, http.StatusOK, page)
		return
	}
	difficulty, err := httpx.ParseEnumQuery(request, "difficulty", "easy", "medium", "hard")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	command := app.ListPublishedQuestions{
		Limit:      limit,
		CursorSort: cursor.SortValue,
		CursorID:   cursor.ID,
		Difficulty: difficulty,
		Tag:        strings.TrimSpace(query.Get("tag")),
		Language:   strings.TrimSpace(query.Get("language")),
	}
	page, err := handler.service.ListPublishedQuestions(request.Context(), decision.Capability, command)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

func (handler *Handler) listQuestionVersions(writer http.ResponseWriter, request *http.Request) {
	questionID, err := httpx.ParseUUIDPathValue(request, "question_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	query := request.URL.Query()
	limit, err := pagination.ParseLimit(query.Get("limit"), 20, 100)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	cursor, _, err := pagination.Parse(query.Get("cursor"))
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "questions", "versions", questionID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	status, err := httpx.ParseEnumQuery(request, "status", "draft", "published", "retired")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	command := app.ListQuestionVersions{
		QuestionID: questionID,
		Limit:      limit,
		CursorSort: cursor.SortValue,
		CursorID:   cursor.ID,
		Status:     status,
	}
	page, err := handler.service.ListQuestionVersions(request.Context(), decision.Capability, command)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

func objectReference(request objectReferenceRequest) app.ObjectReference {
	return app.ObjectReference{
		ObjectKey: request.ObjectKey, Checksum: request.Checksum,
		EncryptionKeyReference: request.EncryptionKeyReference,
	}
}

func idempotencyKey(request *http.Request) (string, error) {
	key := strings.TrimSpace(request.Header.Get("Idempotency-Key"))
	if key == "" {
		return "", apperrors.New(apperrors.CodeInvalidArgument, "Idempotency-Key header is required")
	}
	return key, nil
}

type deleteQuestionRequest struct {
	Reason string `json:"reason"`
}

func (handler *Handler) deleteQuestion(writer http.ResponseWriter, request *http.Request) {
	questionID, err := httpx.ParseUUIDPathValue(request, "question_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body deleteQuestionRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	tenantID := strings.TrimSpace(request.Header.Get("X-Tenant-ID"))
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "questions", questionID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.DeleteQuestion(request.Context(), decision.Capability, app.DeleteQuestion{ID: questionID, ActorID: decision.PrincipalID, Reason: body.Reason}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) hardDeleteQuestion(writer http.ResponseWriter, request *http.Request) {
	questionID, err := httpx.ParseUUIDPathValue(request, "question_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body deleteQuestionRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	tenantID := strings.TrimSpace(request.Header.Get("X-Tenant-ID"))
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "questions", questionID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.HardDeleteQuestion(request.Context(), decision.Capability, app.DeleteQuestion{ID: questionID, ActorID: decision.PrincipalID, Reason: body.Reason}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) deleteQuestionVersion(writer http.ResponseWriter, request *http.Request) {
	questionVersionID, err := httpx.ParseUUIDPathValue(request, "question_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body deleteQuestionRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	tenantID := strings.TrimSpace(request.Header.Get("X-Tenant-ID"))
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "question_versions", questionVersionID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.DeleteQuestionVersion(request.Context(), decision.Capability, app.DeleteQuestionVersion{ID: questionVersionID, ActorID: decision.PrincipalID, Reason: body.Reason}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) hardDeleteQuestionVersion(writer http.ResponseWriter, request *http.Request) {
	questionVersionID, err := httpx.ParseUUIDPathValue(request, "question_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body deleteQuestionRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	tenantID := strings.TrimSpace(request.Header.Get("X-Tenant-ID"))
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "delete", "question_versions", questionVersionID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.HardDeleteQuestionVersion(request.Context(), decision.Capability, app.DeleteQuestionVersion{ID: questionVersionID, ActorID: decision.PrincipalID, Reason: body.Reason}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

// getAsset decrypts and streams one named asset for a question version.
// Requires read authorization on the question_versions resource.
func (handler *Handler) getAsset(writer http.ResponseWriter, request *http.Request) {
	questionVersionID, err := httpx.ParseUUIDPathValue(request, "question_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	assetKind := strings.TrimSpace(request.PathValue("asset_kind"))
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "question_versions", questionVersionID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	content, err := handler.service.GetAsset(request.Context(), decision.Capability, app.GetAssetCmd{
		QuestionVersionID: questionVersionID,
		AssetKind:         assetKind,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.Header().Set("Content-Type", content.ContentType)
	writer.Header().Set("Content-Length", strconv.Itoa(len(content.Data)))
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write(content.Data)
}

// exportQuestionVersion returns a question with all of its tests as a
// portable file (ADR-0032). Only college and platform administrators obtain
// the question_exports capability, and each export is recorded.
func (handler *Handler) exportQuestionVersion(writer http.ResponseWriter, request *http.Request) {
	questionVersionID, err := httpx.ParseUUIDPathValue(request, "question_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "question_exports", questionVersionID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	export, err := handler.service.ExportQuestionVersion(request.Context(), decision.Capability, questionVersionID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(writer, http.StatusOK, export)
}

type modelCheckRequest struct {
	Language string `json:"language"`
	Source   string `json:"source"`
}

// startModelCheck runs an author's reference solution on every test of the
// version, hidden ones included (ADR-0033).
func (handler *Handler) startModelCheck(writer http.ResponseWriter, request *http.Request) {
	questionVersionID, err := httpx.ParseUUIDPathValue(request, "question_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body modelCheckRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "question_versions", questionVersionID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := handler.service.StartModelCheck(request.Context(), decision.Capability, app.StartModelCheck{
		QuestionVersionID: questionVersionID, Language: body.Language, Source: body.Source,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusAccepted, map[string]string{"id": id})
}

func (handler *Handler) listModelChecks(writer http.ResponseWriter, request *http.Request) {
	questionVersionID, err := httpx.ParseUUIDPathValue(request, "question_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "question_versions", questionVersionID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	checks, err := handler.service.ListModelChecks(request.Context(), decision.Capability, questionVersionID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(writer, http.StatusOK, checks)
}

type choicesRequest struct {
	ExpectedQuestionVersion int64    `json:"expected_question_version"`
	Choices                 []string `json:"choices"`
	CorrectChoices          []int    `json:"correct_choices"`
	MultipleChoice          bool     `json:"multiple_choice"`
}

// setQuestionVersionChoices makes a draft multiple-choice (ADR-0035).
func (handler *Handler) setQuestionVersionChoices(writer http.ResponseWriter, request *http.Request) {
	questionVersionID, err := httpx.ParseUUIDPathValue(request, "question_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body choicesRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "question_versions", questionVersionID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	version, err := handler.service.SetQuestionVersionChoices(request.Context(), decision.Capability, app.SetQuestionVersionChoices{
		QuestionVersionID: questionVersionID, ExpectedQuestionVersion: body.ExpectedQuestionVersion,
		Choices: body.Choices, CorrectChoices: body.CorrectChoices, MultipleChoice: body.MultipleChoice,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, version)
}

// setQuestionAudience moves a question between tests and practice (ADR-0041).
func (handler *Handler) setQuestionAudience(writer http.ResponseWriter, request *http.Request) {
	questionID, err := httpx.ParseUUIDPathValue(request, "question_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body struct {
		Audience string `json:"audience"`
	}
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "questions", questionID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.SetQuestionAudience(request.Context(), decision.Capability, app.SetQuestionAudience{
		QuestionID: questionID, Audience: body.Audience,
	}); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, map[string]string{"audience": body.Audience})
}

// authorizePractice obtains the student's own practice capability for the
// tenant in the path.
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
