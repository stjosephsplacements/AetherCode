-- Strip author_id / created_by from community JSON builders.
SET ROLE aether_notification_owner;

CREATE OR REPLACE FUNCTION notification.community_post_json(p_row notification.community_posts, p_with_body boolean)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
    SELECT jsonb_build_object(
        'id', p_row.id, 'title', p_row.title, 'tags', to_jsonb(p_row.tags), 'status', p_row.status,
        'published_at', p_row.published_at, 'updated_at', p_row.updated_at,
        'excerpt', left(p_row.body_markdown, 280)
    ) || CASE WHEN p_with_body THEN jsonb_build_object('body_markdown', p_row.body_markdown) ELSE '{}'::jsonb END
$function$;

CREATE OR REPLACE FUNCTION notification.community_feed_json(p_row notification.community_feed_items, p_bookmarked boolean)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $function$
    SELECT jsonb_build_object(
        'id', p_row.id, 'kind', p_row.kind, 'title', p_row.title, 'description', p_row.description,
        'url', p_row.url, 'platform', p_row.platform, 'starts_at', p_row.starts_at, 'ends_at', p_row.ends_at,
        'tags', to_jsonb(p_row.tags), 'bookmarked', p_bookmarked,
        'phase', CASE
            WHEN p_row.ends_at IS NOT NULL AND p_row.ends_at < clock_timestamp() THEN 'ended'
            WHEN p_row.starts_at IS NOT NULL AND p_row.starts_at > clock_timestamp() THEN 'upcoming'
            ELSE 'live' END
    )
$function$;

RESET ROLE;
