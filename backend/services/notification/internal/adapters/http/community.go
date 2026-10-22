package httpadapter

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/httpauth"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
)

// communityRoute binds one URL to one database function (ADR-0048). Member
// routes authorize as the signed-in person on notification.community; staff
// routes authorize on notification.community_moderation, which students never
// hold.
type communityRoute struct {
	pattern  string
	function string
	staff    bool
	write    bool
	status   int
}

var communityRoutes = []communityRoute{
	{"GET /v1/tenants/{tenant_id}/community/interview-experiences", "community_experience_list", false, false, http.StatusOK},
	{"POST /v1/tenants/{tenant_id}/community/interview-experiences", "community_experience_submit", false, true, http.StatusCreated},
	{"DELETE /v1/tenants/{tenant_id}/community/interview-experiences/{id}", "community_experience_delete_own", false, true, http.StatusOK},
	{"GET /v1/tenants/{tenant_id}/community/posts", "community_posts_list", false, false, http.StatusOK},
	{"GET /v1/tenants/{tenant_id}/community/posts/{id}", "community_post_get", false, false, http.StatusOK},
	{"GET /v1/tenants/{tenant_id}/community/feed", "community_feed_list", false, false, http.StatusOK},
	{"PUT /v1/tenants/{tenant_id}/community/feed/{id}/bookmark", "community_bookmark_set", false, true, http.StatusOK},
	{"GET /v1/tenants/{tenant_id}/community/profile-links", "community_links_get", false, false, http.StatusOK},
	{"PUT /v1/tenants/{tenant_id}/community/profile-links/{platform}", "community_link_set", false, true, http.StatusOK},
	{"GET /v1/tenants/{tenant_id}/community/tasks", "community_tasks_list", false, false, http.StatusOK},
	{"POST /v1/tenants/{tenant_id}/community/tasks", "community_task_create", false, true, http.StatusCreated},
	{"PATCH /v1/tenants/{tenant_id}/community/tasks/{id}", "community_task_update", false, true, http.StatusOK},
	{"DELETE /v1/tenants/{tenant_id}/community/tasks/{id}", "community_task_delete", false, true, http.StatusOK},

	{"GET /v1/tenants/{tenant_id}/community/moderation/interview-experiences", "community_experience_queue", true, false, http.StatusOK},
	{"POST /v1/tenants/{tenant_id}/community/moderation/interview-experiences/{id}/review", "community_experience_review", true, true, http.StatusOK},
	{"GET /v1/tenants/{tenant_id}/community/moderation/posts", "community_posts_manage", true, false, http.StatusOK},
	{"PUT /v1/tenants/{tenant_id}/community/moderation/posts", "community_post_save", true, true, http.StatusOK},
	{"DELETE /v1/tenants/{tenant_id}/community/moderation/posts/{id}", "community_post_delete", true, true, http.StatusOK},
	{"PUT /v1/tenants/{tenant_id}/community/moderation/feed", "community_feed_save", true, true, http.StatusOK},
	{"DELETE /v1/tenants/{tenant_id}/community/moderation/feed/{id}", "community_feed_delete", true, true, http.StatusOK},
}

// communityFlags are the query parameters that carry booleans; limit is a number.
var communityFlags = map[string]struct{}{"mine": {}, "upcoming": {}, "bookmarked": {}}

func (handler *Handler) registerCommunity(mux *http.ServeMux) {
	for _, route := range communityRoutes {
		mux.HandleFunc(route.pattern, handler.community(route))
	}
}

func (handler *Handler) community(route communityRoute) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
		if err != nil {
			httpx.WriteError(writer, err)
			return
		}
		args, err := communityArguments(request)
		if err != nil {
			httpx.WriteError(writer, err)
			return
		}
		action, resource := "read", "community"
		if route.write {
			action = "write"
		}
		var decision httpauth.Decision
		if route.staff {
			resource = "community_moderation"
			decision, err = handler.authorizer.AuthorizeHTTP(request.Context(), request, action, resource, tenantID, tenantID)
		} else {
			decision, err = handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, action, resource, tenantID)
		}
		if err != nil {
			httpx.WriteError(writer, err)
			return
		}
		result, err := handler.service.Community(request.Context(), decision.Capability, route.function, tenantID, args)
		if err != nil {
			httpx.WriteError(writer, err)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.Header().Set("Cache-Control", "no-store")
		writer.WriteHeader(route.status)
		_, _ = writer.Write(wrapItems(result))
	}
}

// communityArguments merges the body, the query string and the path values;
// path values win, so a body cannot name another record than the URL does.
func communityArguments(request *http.Request) (map[string]any, error) {
	args := map[string]any{}
	if request.Method == http.MethodPost || request.Method == http.MethodPut || request.Method == http.MethodPatch {
		body, err := io.ReadAll(io.LimitReader(request.Body, 256<<10+1))
		if err != nil || len(body) > 256<<10 {
			return nil, apperrors.New(apperrors.CodeInvalidArgument, "JSON request body is invalid or too large")
		}
		if len(body) > 0 {
			if err := json.Unmarshal(body, &args); err != nil || args == nil {
				return nil, apperrors.New(apperrors.CodeInvalidArgument, "JSON request body must be an object")
			}
		}
	}
	for key, values := range request.URL.Query() {
		if len(values) == 0 {
			continue
		}
		if _, flag := communityFlags[key]; flag {
			value, err := strconv.ParseBool(values[0])
			if err != nil {
				return nil, apperrors.New(apperrors.CodeInvalidArgument, key+" must be true or false")
			}
			args[key] = value
		} else if key == "limit" {
			value, err := strconv.Atoi(values[0])
			if err != nil {
				return nil, apperrors.New(apperrors.CodeInvalidArgument, "limit must be a number")
			}
			args[key] = value
		} else {
			args[key] = values[0]
		}
	}
	for _, name := range []string{"id", "platform"} {
		if value := request.PathValue(name); value != "" {
			args[name] = value
		}
	}
	return args, nil
}

// wrapItems puts a JSON array under "items", as the other list endpoints do.
func wrapItems(raw json.RawMessage) []byte {
	if len(raw) > 0 && raw[0] == '[' {
		return append(append([]byte(`{"items":`), raw...), '}')
	}
	return raw
}
