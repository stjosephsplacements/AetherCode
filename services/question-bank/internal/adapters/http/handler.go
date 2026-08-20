// Package httpadapter exposes Question Bank's protected authoring API.
package httpadapter

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
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
	mux.HandleFunc("PUT /v1/question-versions/{question_version_id}/manifests/{manifest_kind}", handler.upsertTestCaseManifest)
	mux.HandleFunc("POST /v1/question-versions/{question_version_id}/assets", handler.addQuestionAsset)
	mux.HandleFunc("PUT /v1/question-versions/{question_version_id}/tags", handler.replaceQuestionVersionTags)
	mux.HandleFunc("POST /v1/question-versions/{question_version_id}/publish", handler.publishQuestionVersion)
	mux.HandleFunc("DELETE /v1/questions/{question_id}", handler.deleteQuestion)
	mux.HandleFunc("DELETE /v1/questions/{question_id}/hard", handler.hardDeleteQuestion)
	mux.HandleFunc("GET /v1/question-versions/{question_version_id}/assets/{asset_kind}", handler.getAsset)
	mux.HandleFunc("GET /v1/question-versions/{question_version_id}/bundle", handler.getBundle)
	return mux, nil
}

type objectReferenceRequest struct {
	ObjectKey              string `json:"object_key"`
	Checksum               string `json:"checksum"`
	EncryptionKeyReference string `json:"encryption_key_reference"`
}

type versionContentRequest struct {
	Title              string                 `json:"title"`
	PromptMarkdown     string                 `json:"prompt_markdown"`
	Difficulty         string                 `json:"difficulty"`
	SupportedLanguages []string               `json:"supported_languages"`
	TimeLimitMS        int                    `json:"time_limit_ms"`
	MemoryLimitKiB     int                    `json:"memory_limit_kib"`
	EvaluationBundle   objectReferenceRequest `json:"evaluation_bundle"`
	Tags               []string               `json:"tags"`
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
		EvaluationBundle: app.ObjectReference{
			ObjectKey: request.EvaluationBundle.ObjectKey, Checksum: request.EvaluationBundle.Checksum,
			EncryptionKeyReference: request.EvaluationBundle.EncryptionKeyReference,
		},
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

type manifestRequest struct {
	ExpectedQuestionVersion int64                  `json:"expected_question_version"`
	ObjectReference         objectReferenceRequest `json:"object_reference"`
	TestCaseCount           int                    `json:"test_case_count"`
}

func (handler *Handler) upsertTestCaseManifest(writer http.ResponseWriter, request *http.Request) {
	questionVersionID, err := httpx.ParseUUIDPathValue(request, "question_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	manifestKind := strings.ToLower(strings.TrimSpace(request.PathValue("manifest_kind")))
	if manifestKind != "sample" && manifestKind != "hidden" {
		httpx.WriteError(writer, apperrors.New(apperrors.CodeInvalidArgument, "manifest_kind must be sample or hidden"))
		return
	}
	var body manifestRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	key, err := idempotencyKey(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	manifestID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "test_case_manifests", manifestID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	version, err := handler.service.UpsertTestCaseManifest(request.Context(), decision.Capability, app.UpsertTestCaseManifest{
		WriteCommand: app.WriteCommand{IdempotencyKey: key}, ID: manifestID,
		QuestionVersionID: questionVersionID, ManifestKind: manifestKind,
		ObjectReference: objectReference(body.ObjectReference), TestCaseCount: body.TestCaseCount,
		ExpectedQuestionVersion: body.ExpectedQuestionVersion,
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
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write(content.Data)
}

// getBundle decrypts and streams the evaluation bundle for a question version.
// Requires read authorization on the question_versions resource.
func (handler *Handler) getBundle(writer http.ResponseWriter, request *http.Request) {
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
	data, err := handler.service.GetBundle(request.Context(), decision.Capability, app.GetBundleCmd{
		QuestionVersionID: questionVersionID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.Header().Set("Content-Type", "application/octet-stream")
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write(data)
}
