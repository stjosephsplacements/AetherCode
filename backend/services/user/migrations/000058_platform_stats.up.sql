-- Coding-platform profile stats cached for staff (ADR-0059 §3).
SET ROLE aether_user_owner;

CREATE TABLE users.platform_stats (
    tenant_id uuid NOT NULL,
    student_id uuid NOT NULL REFERENCES users.students (id) ON DELETE CASCADE,
    platform text NOT NULL CHECK (platform IN ('leetcode', 'github', 'codeforces', 'codechef', 'hackerrank', 'atcoder', 'skillrack')),
    handle text NOT NULL CHECK (length(btrim(handle)) BETWEEN 1 AND 120),
    stats jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(stats) = 'array'),
    fetched_at timestamptz,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'fresh', 'stale', 'failed')),
    failure text CHECK (failure IS NULL OR length(failure) <= 500),
    PRIMARY KEY (student_id, platform)
);
CREATE INDEX platform_stats_tenant_status_idx ON users.platform_stats (tenant_id, status, fetched_at);

CREATE TABLE users.platform_stats_sync_requests (
    tenant_id uuid PRIMARY KEY,
    requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    requested_by uuid NOT NULL
);

ALTER TABLE users.platform_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.platform_stats FORCE ROW LEVEL SECURITY;
ALTER TABLE users.platform_stats_sync_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.platform_stats_sync_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_stats_owner ON users.platform_stats FOR ALL TO aether_user_owner USING (true) WITH CHECK (true);
CREATE POLICY platform_stats_sync_owner ON users.platform_stats_sync_requests FOR ALL TO aether_user_owner USING (true) WITH CHECK (true);

CREATE FUNCTION users.platform_profiles_list(
    p_tenant_id uuid,
    p_platform text,
    p_status text,
    p_batch_id uuid,
    p_limit integer,
    p_cursor text
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, users, authz
AS $function$
DECLARE
    cursor_sort text;
    cursor_id uuid;
    cursor_platform text;
BEGIN
    IF p_tenant_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 201 THEN
        RAISE EXCEPTION 'tenant and a limit of 1 to 201 are required' USING ERRCODE = '23514';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'user.read', 'users.platform_profiles') THEN
        RAISE EXCEPTION 'not allowed to read platform profiles' USING ERRCODE = '42501';
    END IF;
    IF p_platform IS NOT NULL AND btrim(p_platform) <> ''
       AND p_platform NOT IN ('leetcode', 'github', 'codeforces', 'codechef', 'hackerrank', 'atcoder', 'skillrack') THEN
        RAISE EXCEPTION 'unknown platform filter' USING ERRCODE = '22023';
    END IF;
    IF p_status IS NOT NULL AND btrim(p_status) <> ''
       AND p_status NOT IN ('pending', 'fresh', 'stale', 'failed') THEN
        RAISE EXCEPTION 'unknown status filter' USING ERRCODE = '22023';
    END IF;
    IF p_cursor IS NOT NULL AND btrim(p_cursor) <> '' THEN
        cursor_sort := split_part(p_cursor, '|', 1);
        cursor_id := NULLIF(split_part(p_cursor, '|', 2), '')::uuid;
        cursor_platform := split_part(p_cursor, '|', 3);
        IF cursor_id IS NULL OR cursor_platform IS NULL THEN
            RAISE EXCEPTION 'cursor is invalid' USING ERRCODE = '22023';
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'student_id', row.student_id::text,
                       'principal_id', row.principal_id::text,
                       'enrollment_number', row.enrollment_number,
                       'profile_name', row.profile_name,
                       'platform', row.platform,
                       'handle', row.handle,
                       'stats', row.stats,
                       'fetched_at', row.fetched_at,
                       'status', row.status,
                       'failure', row.failure
                   ) ORDER BY row.sort_name, row.student_id, row.platform)
            FROM (
                SELECT stat.student_id, student.principal_id, student.enrollment_number,
                       COALESCE(NULLIF(btrim(profile.preferred_name), ''),
                                btrim(concat_ws(' ', profile.given_name, profile.family_name))) AS profile_name,
                       lower(COALESCE(NULLIF(btrim(profile.preferred_name), ''),
                                      btrim(concat_ws(' ', profile.given_name, profile.family_name)), '')) AS sort_name,
                       stat.platform, stat.handle, stat.stats, stat.fetched_at, stat.status, stat.failure
                FROM users.platform_stats AS stat
                JOIN users.students AS student ON student.id = stat.student_id AND student.deleted_at IS NULL
                LEFT JOIN users.profiles AS profile ON profile.principal_id = student.principal_id
                LEFT JOIN users.current_student_batch_affiliations AS affiliation
                       ON affiliation.student_id = student.id AND affiliation.lifecycle_state = 'active'
                WHERE stat.tenant_id = p_tenant_id
                  AND (p_platform IS NULL OR btrim(p_platform) = '' OR stat.platform = p_platform)
                  AND (p_status IS NULL OR btrim(p_status) = '' OR stat.status = p_status)
                  AND (p_batch_id IS NULL OR affiliation.batch_id = p_batch_id)
                  AND (
                        p_cursor IS NULL OR btrim(p_cursor) = ''
                        OR (lower(COALESCE(NULLIF(btrim(profile.preferred_name), ''),
                                          btrim(concat_ws(' ', profile.given_name, profile.family_name)), '')),
                            student.id::text, stat.platform)
                           > (cursor_sort, cursor_id::text, cursor_platform)
                      )
                ORDER BY sort_name, student.id, stat.platform
                LIMIT p_limit
            ) AS row
        ), '[]'::jsonb),
        'summary', jsonb_build_object(
            'total', (SELECT count(*)::bigint FROM users.platform_stats WHERE tenant_id = p_tenant_id),
            'fresh', (SELECT count(*)::bigint FROM users.platform_stats WHERE tenant_id = p_tenant_id AND status = 'fresh'),
            'stale', (SELECT count(*)::bigint FROM users.platform_stats WHERE tenant_id = p_tenant_id AND status = 'stale'),
            'pending', (SELECT count(*)::bigint FROM users.platform_stats WHERE tenant_id = p_tenant_id AND status = 'pending'),
            'failed', (SELECT count(*)::bigint FROM users.platform_stats WHERE tenant_id = p_tenant_id AND status = 'failed')
        )
    );
END
$function$;

CREATE FUNCTION users.platform_profiles_sync_request(p_tenant_id uuid, p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, users, authz
AS $function$
DECLARE
    actor uuid;
    bulk boolean := p_student_id IS NULL;
BEGIN
    actor := authz.current_context_actor_id();
    IF actor IS NULL THEN
        RAISE EXCEPTION 'no signed context' USING ERRCODE = '42501';
    END IF;
    IF bulk THEN
        IF NOT authz.current_context_allows(p_tenant_id, 'user.write', 'users.platform_profiles') THEN
            RAISE EXCEPTION 'not allowed to sync platform profiles' USING ERRCODE = '42501';
        END IF;
        IF EXISTS (
            SELECT 1 FROM users.platform_stats_sync_requests
            WHERE tenant_id = p_tenant_id AND requested_at > clock_timestamp() - interval '10 minutes'
        ) THEN
            RAISE EXCEPTION 'college sync is rate limited to once per 10 minutes' USING ERRCODE = '22023';
        END IF;
        INSERT INTO users.platform_stats_sync_requests (tenant_id, requested_at, requested_by)
        VALUES (p_tenant_id, clock_timestamp(), actor)
        ON CONFLICT (tenant_id) DO UPDATE
            SET requested_at = EXCLUDED.requested_at, requested_by = EXCLUDED.requested_by;
        UPDATE users.platform_stats AS stat
        SET status = 'pending', failure = NULL
        WHERE stat.tenant_id = p_tenant_id;
    ELSE
        IF NOT (authz.current_context_allows(p_tenant_id, 'user.write', 'users.platform_profiles')
            OR users.current_context_valid_student(p_tenant_id, p_student_id, 'user.read', 'users.students')) THEN
            RAISE EXCEPTION 'not allowed to sync this student' USING ERRCODE = '42501';
        END IF;
        UPDATE users.platform_stats AS stat
        SET status = 'pending', failure = NULL
        WHERE stat.tenant_id = p_tenant_id AND stat.student_id = p_student_id;
    END IF;
    RETURN jsonb_build_object('queued', true);
END
$function$;

CREATE FUNCTION users.platform_stats_upsert_link(
    p_tenant_id uuid,
    p_student_id uuid,
    p_platform text,
    p_handle text
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, users
AS $function$
BEGIN
    IF p_tenant_id IS NULL OR p_student_id IS NULL OR p_platform IS NULL OR btrim(p_handle) = '' THEN
        RETURN;
    END IF;
    INSERT INTO users.platform_stats (tenant_id, student_id, platform, handle, status)
    VALUES (p_tenant_id, p_student_id, p_platform, btrim(p_handle), 'pending')
    ON CONFLICT (student_id, platform) DO UPDATE
        SET handle = EXCLUDED.handle,
            status = CASE
                WHEN users.platform_stats.handle IS DISTINCT FROM EXCLUDED.handle THEN 'pending'
                ELSE users.platform_stats.status
            END;
END
$function$;

CREATE FUNCTION users.platform_stats_claim_refresh(p_limit integer)
RETURNS TABLE (
    tenant_id uuid,
    student_id uuid,
    platform text,
    handle text
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, users
AS $function$
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
        RAISE EXCEPTION 'limit must be between 1 and 50' USING ERRCODE = '23514';
    END IF;
    RETURN QUERY
    WITH picked AS (
        SELECT stat.student_id, stat.platform
        FROM users.platform_stats AS stat
        WHERE stat.status IN ('pending', 'stale')
           OR (stat.status = 'fresh' AND stat.fetched_at < clock_timestamp() - interval '6 hours')
           OR (stat.status = 'failed' AND stat.fetched_at < clock_timestamp() - interval '1 hour')
        ORDER BY stat.fetched_at NULLS FIRST, stat.student_id, stat.platform
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    UPDATE users.platform_stats AS stat
    SET status = 'pending'
    FROM picked
    WHERE stat.student_id = picked.student_id AND stat.platform = picked.platform
    RETURNING stat.tenant_id, stat.student_id, stat.platform, stat.handle;
END
$function$;

CREATE FUNCTION users.platform_stats_save(
    p_student_id uuid,
    p_platform text,
    p_stats jsonb,
    p_status text,
    p_failure text
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, users
AS $function$
BEGIN
    IF p_status NOT IN ('fresh', 'stale', 'failed') THEN
        RAISE EXCEPTION 'status must be fresh, stale or failed' USING ERRCODE = '22023';
    END IF;
    UPDATE users.platform_stats
    SET stats = COALESCE(p_stats, '[]'::jsonb),
        fetched_at = clock_timestamp(),
        status = p_status,
        failure = NULLIF(btrim(p_failure), '')
    WHERE student_id = p_student_id AND platform = p_platform;
END
$function$;

REVOKE ALL ON FUNCTION users.platform_profiles_list(uuid, text, text, uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION users.platform_profiles_sync_request(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION users.platform_stats_upsert_link(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION users.platform_stats_claim_refresh(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION users.platform_stats_save(uuid, text, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION users.platform_profiles_list(uuid, text, text, uuid, integer, text) TO aether_user_app;
GRANT EXECUTE ON FUNCTION users.platform_profiles_sync_request(uuid, uuid) TO aether_user_app;
GRANT EXECUTE ON FUNCTION users.platform_stats_upsert_link(uuid, uuid, text, text) TO aether_user_app;

DO $grant_worker$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aether_user_platform_stats_worker') THEN
        GRANT EXECUTE ON FUNCTION users.platform_stats_upsert_link(uuid, uuid, text, text) TO aether_user_platform_stats_worker;
        GRANT EXECUTE ON FUNCTION users.platform_stats_claim_refresh(integer) TO aether_user_platform_stats_worker;
        GRANT EXECUTE ON FUNCTION users.platform_stats_save(uuid, text, jsonb, text, text) TO aether_user_platform_stats_worker;
    END IF;
END
$grant_worker$;

RESET ROLE;