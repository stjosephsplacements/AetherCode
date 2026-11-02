package httpadapter

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/services/question-bank/internal/app"
)

// Categories file a question under Arrays, Strings, DP and so on (ADR-0052).
// Adding one is open to every author. Renaming, merging and deleting use the
// qbank.category_management resource, which the User service grants to
// administrators only.
func (handler *Handler) registerCategoryRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/categories", handler.listCategories)
	mux.HandleFunc("POST /v1/categories", handler.createCategory)
	mux.HandleFunc("PATCH /v1/categories/{category_id}", handler.renameCategory)
	mux.HandleFunc("DELETE /v1/categories/{category_id}", handler.deleteCategory)
	mux.HandleFunc("PUT /v1/questions/{question_id}/category", handler.setQuestionCategory)
	mux.HandleFunc("PUT /v1/questions/{question_id}/tags", handler.setQuestionTags)
	mux.HandleFunc("GET /v1/tags", handler.listTags)
}

func (handler *Handler) listCategories(writer http.ResponseWriter, request *http.Request) {
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "categories", "list", "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	raw, err := handler.service.ListCategories(request.Context(), decision.Capability)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, map[string]json.RawMessage{"categories": raw})
}

type categoryNameRequest struct {
	Name     string `json:"name"`
	ParentID string `json:"parent_id"`
}

func (handler *Handler) createCategory(writer http.ResponseWriter, request *http.Request) {
	var body categoryNameRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "categories", id, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	raw, err := handler.service.CreateCategory(request.Context(), decision.Capability, app.CreateCategory{ID: id, Name: body.Name, ParentID: body.ParentID})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, raw)
}

// renameCategory renames a category, moves it (parent_id, null for top level), or both.
func (handler *Handler) renameCategory(writer http.ResponseWriter, request *http.Request) {
	id, err := httpx.ParseUUIDPathValue(request, "category_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body struct {
		Name     *string         `json:"name"`
		ParentID json.RawMessage `json:"parent_id"`
	}
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var parentID string
	if body.ParentID != nil && json.Unmarshal(body.ParentID, &parentID) != nil {
		httpx.WriteError(writer, apperrors.New(apperrors.CodeInvalidArgument, "parent_id must be a category identifier or null"))
		return
	}
	if body.Name == nil && body.ParentID == nil {
		httpx.WriteError(writer, apperrors.New(apperrors.CodeInvalidArgument, "name or parent_id is required"))
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "category_management", id, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	raw, err := handler.service.UpdateCategory(request.Context(), decision.Capability, app.UpdateCategory{ID: id, Name: body.Name, MoveTo: body.ParentID != nil, ParentID: parentID})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, raw)
}

// deleteCategory moves the category's questions to ?move_to, or to Uncategorised.
func (handler *Handler) deleteCategory(writer http.ResponseWriter, request *http.Request) {
	id, err := httpx.ParseUUIDPathValue(request, "category_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "category_management", id, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	raw, err := handler.service.DeleteCategory(request.Context(), decision.Capability, app.DeleteCategory{ID: id, MoveTo: request.URL.Query().Get("move_to")})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, raw)
}

func (handler *Handler) setQuestionCategory(writer http.ResponseWriter, request *http.Request) {
	questionID, err := httpx.ParseUUIDPathValue(request, "question_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body struct {
		CategoryID string `json:"category_id"`
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
	raw, err := handler.service.SetQuestionCategory(request.Context(), decision.Capability, app.SetQuestionCategory{QuestionID: questionID, CategoryID: body.CategoryID})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, raw)
}

// setQuestionTags replaces the question's tags, however many versions it has and whatever state they are in.
func (handler *Handler) setQuestionTags(writer http.ResponseWriter, request *http.Request) {
	questionID, err := httpx.ParseUUIDPathValue(request, "question_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body tagsRequestOnly
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "questions", questionID, "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	tags := make([]app.Tag, len(body.Tags))
	for index, name := range body.Tags {
		tags[index] = app.Tag{Name: name}
	}
	raw, err := handler.service.SetQuestionTags(request.Context(), decision.Capability, app.SetQuestionTags{QuestionID: questionID, Tags: tags})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, raw)
}

type tagsRequestOnly struct {
	Tags []string `json:"tags"`
}

func (handler *Handler) listTags(writer http.ResponseWriter, request *http.Request) {
	limit := 100
	if raw := request.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			httpx.WriteError(writer, apperrors.New(apperrors.CodeInvalidArgument, "limit must be a number"))
			return
		}
		limit = parsed
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "tags", "list", "")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	raw, err := handler.service.ListTags(request.Context(), decision.Capability, limit)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, map[string]json.RawMessage{"tags": raw})
}
