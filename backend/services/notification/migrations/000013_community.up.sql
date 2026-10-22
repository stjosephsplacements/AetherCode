-- Community content (ADR-0048): interview experiences with staff approval,
-- blog posts, contest/hackathon/open-source listings with bookmarks, linked
-- coding-platform handles and personal tasks. Every table is tenant-scoped and
-- reachable only through the owner-bound functions below, which check the
-- signed context: members on resource notification.community (students bind to
-- their own rows by the signed actor), staff on notification.community_moderation.
SET ROLE aether_notification_owner;

CREATE TABLE notification.community_experiences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    author_id uuid NOT NULL,
    company text NOT NULL CHECK (length(company) BETWEEN 1 AND 200),
    role text NOT NULL CHECK (length(role) BETWEEN 1 AND 200),
    experience_level text NOT NULL CHECK (experience_level IN ('intern', 'fresher', 'experienced')),
    drive_type text NOT NULL CHECK (drive_type IN ('on-campus', 'off-campus', 'pool-campus')),
    package_offered text CHECK (length(package_offered) <= 100),
    year_of_interview integer CHECK (year_of_interview BETWEEN 1990 AND 2100),
    preparation_resources text CHECK (length(preparation_resources) <= 4000),
    rounds jsonb NOT NULL CHECK (jsonb_typeof(rounds) = 'array' AND jsonb_array_length(rounds) BETWEEN 1 AND 15),
    verdict text NOT NULL CHECK (verdict IN ('selected', 'rejected', 'waitlisted')),
    tips text CHECK (length(tips) <= 4000),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    review_note text CHECK (length(review_note) <= 500),
    reviewed_by uuid,
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX community_experiences_tenant_idx ON notification.community_experiences (tenant_id, status, created_at DESC);
CREATE INDEX community_experiences_author_idx ON notification.community_experiences (tenant_id, author_id, created_at DESC);

CREATE TABLE notification.community_posts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    author_id uuid NOT NULL,
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    body_markdown text NOT NULL CHECK (length(body_markdown) BETWEEN 1 AND 50000),
    tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 10),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((status = 'published') = (published_at IS NOT NULL))
);
CREATE INDEX community_posts_tenant_idx ON notification.community_posts (tenant_id, status, published_at DESC);

CREATE TABLE notification.community_feed_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('contest', 'hackathon', 'opensource')),
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
    description text CHECK (length(description) <= 4000),
    url text NOT NULL CHECK (url ~ '^https?://' AND length(url) <= 2000),
    platform text CHECK (length(platform) <= 100),
    starts_at timestamptz,
    ends_at timestamptz,
    tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 10),
    external_id text CHECK (length(external_id) <= 200),
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at)
);
CREATE UNIQUE INDEX community_feed_external_idx ON notification.community_feed_items (tenant_id, kind, external_id)
    WHERE external_id IS NOT NULL;
CREATE INDEX community_feed_tenant_idx ON notification.community_feed_items (tenant_id, kind, starts_at);

CREATE TABLE notification.community_bookmarks (
    tenant_id uuid NOT NULL,
    member_id uuid NOT NULL,
    feed_item_id uuid NOT NULL REFERENCES notification.community_feed_items (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, member_id, feed_item_id)
);

CREATE TABLE notification.community_profile_links (
    tenant_id uuid NOT NULL,
    member_id uuid NOT NULL,
    platform text NOT NULL CHECK (platform IN ('leetcode', 'github', 'codeforces', 'codechef', 'hackerrank')),
    handle text NOT NULL CHECK (handle ~ '^[A-Za-z0-9._-]{1,60}$'),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, member_id, platform)
);

CREATE TABLE notification.community_tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    due_at timestamptz,
    done boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX community_tasks_owner_idx ON notification.community_tasks (tenant_id, owner_id, done, due_at);

DO $policies$
DECLARE protected_table text;
BEGIN
    FOREACH protected_table IN ARRAY ARRAY[
        'community_experiences', 'community_posts', 'community_feed_items',
        'community_bookmarks', 'community_profile_links', 'community_tasks'
    ] LOOP
        EXECUTE format('ALTER TABLE notification.%I ENABLE ROW LEVEL SECURITY', protected_table);
        EXECUTE format('ALTER TABLE notification.%I FORCE ROW LEVEL SECURITY', protected_table);
        -- The application role has no policy and no grant: only the functions below reach these rows.
        EXECUTE format(
            'CREATE POLICY %I ON notification.%I FOR ALL TO aether_notification_owner USING (true) WITH CHECK (true)',
            protected_table || '_owner_maintenance', protected_table);
    END LOOP;
END
$policies$;

-- The signed actor, after proving the context may use the resource in the tenant.
CREATE FUNCTION notification.community_actor(p_tenant_id uuid, p_resource text, p_write boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE
    actor_id uuid := authz.current_context_actor_id();
    allowed boolean;
BEGIN
    IF p_write THEN
        allowed := authz.current_context_allows(p_tenant_id, 'notification.write', 'notification.' || p_resource);
    ELSE
        allowed := authz.current_context_allows_read(p_tenant_id, 'notification.read', 'notification.write', 'notification.' || p_resource);
    END IF;
    IF actor_id IS NULL OR p_tenant_id IS NULL OR NOT COALESCE(allowed, false) THEN
        RAISE EXCEPTION 'authorization context cannot use %', p_resource USING ERRCODE = '42501';
    END IF;
    RETURN actor_id;
END
$function$;

CREATE FUNCTION notification.community_text(p_args jsonb, p_key text, p_min integer, p_max integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
DECLARE value text := btrim(COALESCE(p_args ->> p_key, ''));
BEGIN
    IF length(value) < p_min OR length(value) > p_max THEN
        IF p_min = 0 THEN
            RAISE EXCEPTION '% must be at most % characters', p_key, p_max USING ERRCODE = '22023';
        END IF;
        RAISE EXCEPTION '% must be % to % characters', p_key, p_min, p_max USING ERRCODE = '22023';
    END IF;
    RETURN NULLIF(value, '');
END
$function$;

CREATE FUNCTION notification.community_tags(p_args jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
DECLARE tags text[];
BEGIN
    IF p_args -> 'tags' IS NULL OR jsonb_typeof(p_args -> 'tags') = 'null' THEN
        RETURN '{}';
    END IF;
    IF jsonb_typeof(p_args -> 'tags') <> 'array' OR jsonb_array_length(p_args -> 'tags') > 10 THEN
        RAISE EXCEPTION 'tags must be a list of at most 10 words' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT lower(btrim(tag))), '{}') INTO tags
    FROM jsonb_array_elements_text(p_args -> 'tags') AS tag
    WHERE btrim(tag) <> '';
    IF EXISTS (SELECT 1 FROM unnest(tags) AS tag WHERE length(tag) > 30) THEN
        RAISE EXCEPTION 'a tag is at most 30 characters' USING ERRCODE = '22023';
    END IF;
    RETURN tags;
END
$function$;

CREATE FUNCTION notification.community_limit(p_args jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
    SELECT LEAST(100, GREATEST(1, COALESCE((p_args ->> 'limit')::integer, 50)))
$function$;

-- Interview experiences ------------------------------------------------------

CREATE FUNCTION notification.community_experience_json(p_row notification.community_experiences, p_viewer uuid, p_staff boolean)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
    SELECT jsonb_build_object(
        'id', p_row.id, 'company', p_row.company, 'role', p_row.role,
        'experience_level', p_row.experience_level, 'drive_type', p_row.drive_type,
        'package_offered', p_row.package_offered, 'year_of_interview', p_row.year_of_interview,
        'preparation_resources', p_row.preparation_resources, 'rounds', p_row.rounds,
        'verdict', p_row.verdict, 'tips', p_row.tips, 'status', p_row.status,
        'review_note', CASE WHEN p_staff OR p_row.author_id = p_viewer THEN p_row.review_note END,
        'mine', p_row.author_id = p_viewer, 'created_at', p_row.created_at,
        'author_id', CASE WHEN p_staff THEN p_row.author_id END
    )
$function$;

CREATE FUNCTION notification.community_experience_submit(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE
    actor_id uuid := notification.community_actor(p_tenant_id, 'community', true);
    created notification.community_experiences;
    round_entry jsonb;
BEGIN
    IF jsonb_typeof(p_args -> 'rounds') IS DISTINCT FROM 'array' OR jsonb_array_length(p_args -> 'rounds') NOT BETWEEN 1 AND 15 THEN
        RAISE EXCEPTION 'add 1 to 15 interview rounds' USING ERRCODE = '22023';
    END IF;
    FOR round_entry IN SELECT * FROM jsonb_array_elements(p_args -> 'rounds') LOOP
        IF jsonb_typeof(round_entry) <> 'object' OR length(btrim(COALESCE(round_entry ->> 'title', ''))) NOT BETWEEN 1 AND 200
           OR length(COALESCE(round_entry ->> 'description', '')) > 4000 THEN
            RAISE EXCEPTION 'each round needs a title and a description of at most 4000 characters' USING ERRCODE = '22023';
        END IF;
    END LOOP;
    INSERT INTO notification.community_experiences (
        tenant_id, author_id, company, role, experience_level, drive_type, package_offered,
        year_of_interview, preparation_resources, rounds, verdict, tips
    ) VALUES (
        p_tenant_id, actor_id,
        notification.community_text(p_args, 'company', 1, 200), notification.community_text(p_args, 'role', 1, 200),
        COALESCE(NULLIF(p_args ->> 'experience_level', ''), 'fresher'),
        COALESCE(NULLIF(p_args ->> 'drive_type', ''), 'on-campus'),
        notification.community_text(p_args, 'package_offered', 0, 100),
        NULLIF(p_args ->> 'year_of_interview', '')::integer,
        notification.community_text(p_args, 'preparation_resources', 0, 4000),
        p_args -> 'rounds',
        COALESCE(NULLIF(p_args ->> 'verdict', ''), 'selected'),
        notification.community_text(p_args, 'tips', 0, 4000)
    ) RETURNING * INTO created;
    RETURN notification.community_experience_json(created, actor_id, false);
EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'level, drive type, verdict or year is not a permitted value' USING ERRCODE = '22023';
END
$function$;

CREATE FUNCTION notification.community_experience_list(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE
    actor_id uuid := notification.community_actor(p_tenant_id, 'community', false);
    mine boolean := COALESCE((p_args ->> 'mine')::boolean, false);
    company_filter text := NULLIF(btrim(COALESCE(p_args ->> 'company', '')), '');
BEGIN
    RETURN COALESCE((
        SELECT jsonb_agg(item.doc ORDER BY item.created_at DESC)
        FROM (
            SELECT notification.community_experience_json(experience, actor_id, false) AS doc, experience.created_at
            FROM notification.community_experiences AS experience
            WHERE experience.tenant_id = p_tenant_id
              AND ((mine AND experience.author_id = actor_id) OR (NOT mine AND experience.status = 'approved'))
              AND (company_filter IS NULL OR experience.company ILIKE '%' || replace(replace(company_filter, '%', '\%'), '_', '\_') || '%')
            ORDER BY experience.created_at DESC
            LIMIT notification.community_limit(p_args)
        ) AS item
    ), '[]'::jsonb);
END
$function$;

CREATE FUNCTION notification.community_experience_delete_own(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE actor_id uuid := notification.community_actor(p_tenant_id, 'community', true);
BEGIN
    DELETE FROM notification.community_experiences
    WHERE id = (p_args ->> 'id')::uuid AND tenant_id = p_tenant_id AND author_id = actor_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'experience was not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN '{}'::jsonb;
END
$function$;

CREATE FUNCTION notification.community_experience_queue(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE actor_id uuid := notification.community_actor(p_tenant_id, 'community_moderation', false);
BEGIN
    RETURN COALESCE((
        SELECT jsonb_agg(item.doc ORDER BY item.created_at)
        FROM (
            SELECT notification.community_experience_json(experience, actor_id, true) AS doc, experience.created_at
            FROM notification.community_experiences AS experience
            WHERE experience.tenant_id = p_tenant_id AND experience.status = 'pending'
            ORDER BY experience.created_at
            LIMIT notification.community_limit(p_args)
        ) AS item
    ), '[]'::jsonb);
END
$function$;

CREATE FUNCTION notification.community_experience_review(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE
    actor_id uuid := notification.community_actor(p_tenant_id, 'community_moderation', true);
    reviewed notification.community_experiences;
BEGIN
    IF p_args ->> 'approve' IS NULL THEN
        RAISE EXCEPTION 'approve is required' USING ERRCODE = '22023';
    END IF;
    UPDATE notification.community_experiences
    SET status = CASE WHEN (p_args ->> 'approve')::boolean THEN 'approved' ELSE 'rejected' END,
        review_note = notification.community_text(p_args, 'note', 0, 500),
        reviewed_by = actor_id, reviewed_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE id = (p_args ->> 'id')::uuid AND tenant_id = p_tenant_id
    RETURNING * INTO reviewed;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'experience was not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN notification.community_experience_json(reviewed, actor_id, true);
END
$function$;

-- Posts ----------------------------------------------------------------------

CREATE FUNCTION notification.community_post_json(p_row notification.community_posts, p_with_body boolean)
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

CREATE FUNCTION notification.community_posts_list(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE tag text := lower(NULLIF(btrim(COALESCE(p_args ->> 'tag', '')), ''));
BEGIN
    PERFORM notification.community_actor(p_tenant_id, 'community', false);
    RETURN COALESCE((
        SELECT jsonb_agg(item.doc ORDER BY item.published_at DESC)
        FROM (
            SELECT notification.community_post_json(post, false) AS doc, post.published_at
            FROM notification.community_posts AS post
            WHERE post.tenant_id = p_tenant_id AND post.status = 'published'
              AND (tag IS NULL OR tag = ANY (post.tags))
            ORDER BY post.published_at DESC
            LIMIT notification.community_limit(p_args)
        ) AS item
    ), '[]'::jsonb);
END
$function$;

CREATE FUNCTION notification.community_post_get(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE current_post notification.community_posts;
BEGIN
    PERFORM notification.community_actor(p_tenant_id, 'community', false);
    SELECT * INTO current_post FROM notification.community_posts
    WHERE id = (p_args ->> 'id')::uuid AND tenant_id = p_tenant_id AND status = 'published';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'post was not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN notification.community_post_json(current_post, true);
END
$function$;

CREATE FUNCTION notification.community_posts_manage(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE actor_id uuid := notification.community_actor(p_tenant_id, 'community_moderation', false);
BEGIN
    RETURN COALESCE((
        SELECT jsonb_agg(item.doc ORDER BY item.updated_at DESC)
        FROM (
            SELECT notification.community_post_json(post, true) AS doc, post.updated_at
            FROM notification.community_posts AS post
            WHERE post.tenant_id = p_tenant_id
              AND (p_args ->> 'id' IS NULL OR post.id = (p_args ->> 'id')::uuid)
            ORDER BY post.updated_at DESC
            LIMIT notification.community_limit(p_args)
        ) AS item
    ), '[]'::jsonb);
END
$function$;

CREATE FUNCTION notification.community_post_save(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE
    actor_id uuid := notification.community_actor(p_tenant_id, 'community_moderation', true);
    status_value text := COALESCE(NULLIF(p_args ->> 'status', ''), 'draft');
    saved notification.community_posts;
BEGIN
    IF status_value NOT IN ('draft', 'published') THEN
        RAISE EXCEPTION 'status must be draft or published' USING ERRCODE = '22023';
    END IF;
    IF p_args ->> 'id' IS NULL THEN
        INSERT INTO notification.community_posts (tenant_id, author_id, title, body_markdown, tags, status, published_at)
        VALUES (p_tenant_id, actor_id, notification.community_text(p_args, 'title', 1, 200),
                notification.community_text(p_args, 'body_markdown', 1, 50000), notification.community_tags(p_args),
                status_value, CASE WHEN status_value = 'published' THEN clock_timestamp() END)
        RETURNING * INTO saved;
    ELSE
        UPDATE notification.community_posts
        SET title = notification.community_text(p_args, 'title', 1, 200),
            body_markdown = notification.community_text(p_args, 'body_markdown', 1, 50000),
            tags = notification.community_tags(p_args), status = status_value,
            published_at = CASE WHEN status_value = 'published' THEN COALESCE(published_at, clock_timestamp()) END,
            updated_at = clock_timestamp()
        WHERE id = (p_args ->> 'id')::uuid AND tenant_id = p_tenant_id
        RETURNING * INTO saved;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'post was not found' USING ERRCODE = 'P0002';
        END IF;
    END IF;
    RETURN notification.community_post_json(saved, true);
END
$function$;

CREATE FUNCTION notification.community_post_delete(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
BEGIN
    PERFORM notification.community_actor(p_tenant_id, 'community_moderation', true);
    DELETE FROM notification.community_posts WHERE id = (p_args ->> 'id')::uuid AND tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'post was not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN '{}'::jsonb;
END
$function$;

-- Contests, hackathons and open-source listings ------------------------------

CREATE FUNCTION notification.community_feed_json(p_row notification.community_feed_items, p_bookmarked boolean)
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

CREATE FUNCTION notification.community_feed_list(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE
    actor_id uuid := notification.community_actor(p_tenant_id, 'community', false);
    feed_kind text := NULLIF(p_args ->> 'kind', '');
    platform_filter text := NULLIF(btrim(COALESCE(p_args ->> 'platform', '')), '');
    search text := NULLIF(btrim(COALESCE(p_args ->> 'q', '')), '');
    only_open boolean := COALESCE((p_args ->> 'upcoming')::boolean, false);
    only_marked boolean := COALESCE((p_args ->> 'bookmarked')::boolean, false);
BEGIN
    RETURN COALESCE((
        SELECT jsonb_agg(item.doc ORDER BY item.starts_at NULLS LAST, item.created_at DESC)
        FROM (
            SELECT notification.community_feed_json(entry, bookmark.feed_item_id IS NOT NULL) AS doc, entry.starts_at, entry.created_at
            FROM notification.community_feed_items AS entry
            LEFT JOIN notification.community_bookmarks AS bookmark
              ON bookmark.feed_item_id = entry.id AND bookmark.member_id = actor_id AND bookmark.tenant_id = p_tenant_id
            WHERE entry.tenant_id = p_tenant_id
              AND (feed_kind IS NULL OR entry.kind = feed_kind)
              AND (platform_filter IS NULL OR entry.platform ILIKE platform_filter)
              AND (search IS NULL OR entry.title ILIKE '%' || replace(replace(search, '%', '\%'), '_', '\_') || '%')
              AND (NOT only_open OR entry.ends_at IS NULL OR entry.ends_at >= clock_timestamp())
              AND (NOT only_marked OR bookmark.feed_item_id IS NOT NULL)
            ORDER BY entry.starts_at NULLS LAST, entry.created_at DESC
            LIMIT notification.community_limit(p_args)
        ) AS item
    ), '[]'::jsonb);
END
$function$;

CREATE FUNCTION notification.community_feed_save(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE
    actor_id uuid := notification.community_actor(p_tenant_id, 'community_moderation', true);
    feed_kind text := p_args ->> 'kind';
    external text := notification.community_text(p_args, 'external_id', 0, 200);
    saved notification.community_feed_items;
BEGIN
    IF feed_kind IS NULL OR feed_kind NOT IN ('contest', 'hackathon', 'opensource') THEN
        RAISE EXCEPTION 'kind must be contest, hackathon or opensource' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(p_args ->> 'url', '') !~ '^https?://' THEN
        RAISE EXCEPTION 'url must start with http:// or https://' USING ERRCODE = '22023';
    END IF;
    IF p_args ->> 'id' IS NULL THEN
        INSERT INTO notification.community_feed_items (
            tenant_id, kind, title, description, url, platform, starts_at, ends_at, tags, external_id, created_by
        ) VALUES (
            p_tenant_id, feed_kind, notification.community_text(p_args, 'title', 1, 300),
            notification.community_text(p_args, 'description', 0, 4000), p_args ->> 'url',
            notification.community_text(p_args, 'platform', 0, 100),
            NULLIF(p_args ->> 'starts_at', '')::timestamptz, NULLIF(p_args ->> 'ends_at', '')::timestamptz,
            notification.community_tags(p_args), external, actor_id
        )
        ON CONFLICT (tenant_id, kind, external_id) WHERE external_id IS NOT NULL DO UPDATE
        SET title = EXCLUDED.title, description = EXCLUDED.description, url = EXCLUDED.url, platform = EXCLUDED.platform,
            starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, tags = EXCLUDED.tags,
            updated_at = clock_timestamp()
        RETURNING * INTO saved;
    ELSE
        UPDATE notification.community_feed_items
        SET kind = feed_kind, title = notification.community_text(p_args, 'title', 1, 300),
            description = notification.community_text(p_args, 'description', 0, 4000), url = p_args ->> 'url',
            platform = notification.community_text(p_args, 'platform', 0, 100),
            starts_at = NULLIF(p_args ->> 'starts_at', '')::timestamptz, ends_at = NULLIF(p_args ->> 'ends_at', '')::timestamptz,
            tags = notification.community_tags(p_args), updated_at = clock_timestamp()
        WHERE id = (p_args ->> 'id')::uuid AND tenant_id = p_tenant_id
        RETURNING * INTO saved;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'listing was not found' USING ERRCODE = 'P0002';
        END IF;
    END IF;
    RETURN notification.community_feed_json(saved, false);
EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'the end must not be before the start' USING ERRCODE = '22023';
END
$function$;

CREATE FUNCTION notification.community_feed_delete(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
BEGIN
    PERFORM notification.community_actor(p_tenant_id, 'community_moderation', true);
    DELETE FROM notification.community_feed_items WHERE id = (p_args ->> 'id')::uuid AND tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'listing was not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN '{}'::jsonb;
END
$function$;

CREATE FUNCTION notification.community_bookmark_set(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE
    actor_id uuid := notification.community_actor(p_tenant_id, 'community', true);
    item_id uuid := (p_args ->> 'id')::uuid;
    on_value boolean := COALESCE((p_args ->> 'on')::boolean, true);
BEGIN
    IF NOT EXISTS (SELECT 1 FROM notification.community_feed_items WHERE id = item_id AND tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'listing was not found' USING ERRCODE = 'P0002';
    END IF;
    IF on_value THEN
        INSERT INTO notification.community_bookmarks (tenant_id, member_id, feed_item_id)
        VALUES (p_tenant_id, actor_id, item_id) ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM notification.community_bookmarks
        WHERE tenant_id = p_tenant_id AND member_id = actor_id AND feed_item_id = item_id;
    END IF;
    RETURN jsonb_build_object('bookmarked', on_value);
END
$function$;

-- Linked coding-platform handles ---------------------------------------------

CREATE FUNCTION notification.community_links_get(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE actor_id uuid := notification.community_actor(p_tenant_id, 'community', false);
BEGIN
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object('platform', link.platform, 'handle', link.handle) ORDER BY link.platform)
        FROM notification.community_profile_links AS link
        WHERE link.tenant_id = p_tenant_id AND link.member_id = actor_id
    ), '[]'::jsonb);
END
$function$;

CREATE FUNCTION notification.community_link_set(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE
    actor_id uuid := notification.community_actor(p_tenant_id, 'community', true);
    handle_value text := btrim(COALESCE(p_args ->> 'handle', ''));
BEGIN
    IF handle_value = '' THEN
        DELETE FROM notification.community_profile_links
        WHERE tenant_id = p_tenant_id AND member_id = actor_id AND platform = p_args ->> 'platform';
        RETURN jsonb_build_object('platform', p_args ->> 'platform', 'handle', NULL);
    END IF;
    INSERT INTO notification.community_profile_links (tenant_id, member_id, platform, handle)
    VALUES (p_tenant_id, actor_id, p_args ->> 'platform', handle_value)
    ON CONFLICT (tenant_id, member_id, platform) DO UPDATE SET handle = EXCLUDED.handle, updated_at = clock_timestamp();
    RETURN jsonb_build_object('platform', p_args ->> 'platform', 'handle', handle_value);
EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'choose leetcode, github, codeforces, codechef or hackerrank and a handle of letters, digits, dots, dashes or underscores' USING ERRCODE = '22023';
END
$function$;

-- Personal tasks ---------------------------------------------------------------

CREATE FUNCTION notification.community_task_json(p_row notification.community_tasks)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
    SELECT jsonb_build_object('id', p_row.id, 'title', p_row.title, 'due_at', p_row.due_at, 'done', p_row.done)
$function$;

CREATE FUNCTION notification.community_tasks_list(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE actor_id uuid := notification.community_actor(p_tenant_id, 'community', false);
BEGIN
    RETURN COALESCE((
        SELECT jsonb_agg(item.doc ORDER BY item.done, item.due_at NULLS LAST, item.created_at)
        FROM (
            SELECT notification.community_task_json(task) AS doc, task.done, task.due_at, task.created_at
            FROM notification.community_tasks AS task
            WHERE task.tenant_id = p_tenant_id AND task.owner_id = actor_id
            ORDER BY task.done, task.due_at NULLS LAST, task.created_at
            LIMIT notification.community_limit(p_args)
        ) AS item
    ), '[]'::jsonb);
END
$function$;

CREATE FUNCTION notification.community_task_create(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE
    actor_id uuid := notification.community_actor(p_tenant_id, 'community', true);
    created notification.community_tasks;
BEGIN
    IF (SELECT count(*) FROM notification.community_tasks WHERE tenant_id = p_tenant_id AND owner_id = actor_id) >= 500 THEN
        RAISE EXCEPTION 'delete some tasks first; the limit is 500' USING ERRCODE = '22023';
    END IF;
    INSERT INTO notification.community_tasks (tenant_id, owner_id, title, due_at)
    VALUES (p_tenant_id, actor_id, notification.community_text(p_args, 'title', 1, 200), NULLIF(p_args ->> 'due_at', '')::timestamptz)
    RETURNING * INTO created;
    RETURN notification.community_task_json(created);
END
$function$;

CREATE FUNCTION notification.community_task_update(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE
    actor_id uuid := notification.community_actor(p_tenant_id, 'community', true);
    updated notification.community_tasks;
BEGIN
    UPDATE notification.community_tasks AS task
    SET title = CASE WHEN p_args ? 'title' THEN notification.community_text(p_args, 'title', 1, 200) ELSE task.title END,
        due_at = CASE WHEN p_args ? 'due_at' THEN NULLIF(p_args ->> 'due_at', '')::timestamptz ELSE task.due_at END,
        done = CASE WHEN p_args ? 'done' THEN (p_args ->> 'done')::boolean ELSE task.done END
    WHERE task.id = (p_args ->> 'id')::uuid AND task.tenant_id = p_tenant_id AND task.owner_id = actor_id
    RETURNING * INTO updated;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'task was not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN notification.community_task_json(updated);
END
$function$;

CREATE FUNCTION notification.community_task_delete(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE actor_id uuid := notification.community_actor(p_tenant_id, 'community', true);
BEGIN
    DELETE FROM notification.community_tasks
    WHERE id = (p_args ->> 'id')::uuid AND tenant_id = p_tenant_id AND owner_id = actor_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'task was not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN '{}'::jsonb;
END
$function$;

-- Only the operation functions are callable by the application role.
DO $grants$
DECLARE operation text;
BEGIN
    FOREACH operation IN ARRAY ARRAY[
        'community_experience_submit', 'community_experience_list', 'community_experience_delete_own',
        'community_experience_queue', 'community_experience_review',
        'community_posts_list', 'community_post_get', 'community_posts_manage', 'community_post_save', 'community_post_delete',
        'community_feed_list', 'community_feed_save', 'community_feed_delete', 'community_bookmark_set',
        'community_links_get', 'community_link_set',
        'community_tasks_list', 'community_task_create', 'community_task_update', 'community_task_delete'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION notification.%I(uuid, jsonb) FROM PUBLIC', operation);
        EXECUTE format('GRANT EXECUTE ON FUNCTION notification.%I(uuid, jsonb) TO aether_notification_app', operation);
    END LOOP;
END
$grants$;

RESET ROLE;
