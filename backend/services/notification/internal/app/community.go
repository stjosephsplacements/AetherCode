package app

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"

	"github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
)

// CommunityFunctions are the database operations behind community content
// (ADR-0048). Callers name one of these; nothing else reaches the database.
var CommunityFunctions = map[string]struct{}{
	"community_experience_submit": {}, "community_experience_list": {}, "community_experience_delete_own": {},
	"community_experience_queue": {}, "community_experience_review": {},
	"community_posts_list": {}, "community_post_get": {}, "community_posts_manage": {},
	"community_post_save": {}, "community_post_delete": {},
	"community_feed_list": {}, "community_feed_save": {}, "community_feed_delete": {}, "community_bookmark_set": {},
	"community_links_get": {}, "community_link_set": {},
	"community_tasks_list": {}, "community_task_create": {}, "community_task_update": {}, "community_task_delete": {},
}

// Community runs one community operation in a transaction bound to the signed
// capability. The function checks the signed context itself.
func (service *Service) Community(ctx context.Context, capability authz.Capability, function, tenantID string, args map[string]any) (json.RawMessage, error) {
	if _, known := CommunityFunctions[function]; !known || !validUUID(tenantID) {
		return nil, invalid("community operation or tenant ID is invalid")
	}
	encoded, err := json.Marshal(args)
	if err != nil {
		return nil, invalid("community request is invalid")
	}
	var result json.RawMessage
	err = database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		result, storeErr = service.store.Community(ctx, transaction, function, tenantID, encoded)
		return storeErr
	})
	return result, err
}
