-- Placement-scoped consortium drives (ADR-0081 milestone C MVP).
SET ROLE aether_analytics_owner;

CREATE TABLE analytics.consortium_drives (
    id uuid PRIMARY KEY,
    placement_department_id uuid NOT NULL,
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    metric text NOT NULL DEFAULT 'placement_score'
        CHECK (metric IN ('placement_score')),
    opens_at timestamptz NOT NULL,
    closes_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (closes_at > opens_at)
);

CREATE INDEX consortium_drives_track_idx ON analytics.consortium_drives (placement_department_id, opens_at DESC);

ALTER TABLE analytics.consortium_drives ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.consortium_drives FORCE ROW LEVEL SECURITY;
CREATE POLICY consortium_drives_owner ON analytics.consortium_drives
    FOR ALL TO aether_analytics_owner USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE analytics.consortium_drives FROM PUBLIC;

CREATE FUNCTION analytics.create_consortium_drive(
    p_placement_department_id uuid, p_title text, p_opens_at timestamptz, p_closes_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, authz, analytics
AS $function$
DECLARE
    v_id uuid;
BEGIN
    IF NOT authz.current_context_allows_placement(p_placement_department_id, 'analytics.write', 'analytics.placement_student_rollups') THEN
        RAISE EXCEPTION 'signed authorization context does not allow creating a consortium drive'
            USING ERRCODE = '42501';
    END IF;
    IF p_title IS NULL OR pg_catalog.length(p_title) NOT BETWEEN 1 AND 200
       OR p_opens_at IS NULL OR p_closes_at IS NULL OR p_closes_at <= p_opens_at THEN
        RAISE EXCEPTION 'consortium drive fields are invalid' USING ERRCODE = '22023';
    END IF;
    v_id := gen_random_uuid();
    INSERT INTO analytics.consortium_drives (id, placement_department_id, title, opens_at, closes_at)
    VALUES (v_id, p_placement_department_id, p_title, p_opens_at, p_closes_at);
    RETURN v_id;
END
$function$;

CREATE FUNCTION analytics.list_consortium_drives(p_placement_department_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, authz, analytics
AS $function$
BEGIN
    IF NOT authz.current_context_allows_placement(p_placement_department_id, 'analytics.read', 'analytics.placement_student_rollups') THEN
        RAISE EXCEPTION 'signed authorization context does not allow listing consortium drives'
            USING ERRCODE = '42501';
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', d.id, 'placement_department_id', d.placement_department_id,
            'title', d.title, 'metric', d.metric, 'opens_at', d.opens_at,
            'closes_at', d.closes_at, 'created_at', d.created_at
        ) ORDER BY d.opens_at DESC)
        FROM analytics.consortium_drives AS d
        WHERE d.placement_department_id = p_placement_department_id
    ), '[]'::jsonb);
END
$function$;

CREATE FUNCTION analytics.consortium_drive_leaderboard(p_drive_id uuid, p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, authz, analytics
AS $function$
DECLARE
    v_track uuid;
BEGIN
    SELECT placement_department_id INTO v_track
    FROM analytics.consortium_drives WHERE id = p_drive_id;
    IF v_track IS NULL THEN
        RAISE EXCEPTION 'consortium drive was not found' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows_placement(v_track, 'analytics.read', 'analytics.placement_student_rollups') THEN
        RAISE EXCEPTION 'signed authorization context does not allow reading the leaderboard'
            USING ERRCODE = '42501';
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'tenant_id', r.tenant_id,
            'student_id', r.student_id,
            'score', r.latest_score,
            'activity_at', r.latest_activity_at
        ) ORDER BY r.latest_score DESC NULLS LAST, r.latest_activity_at DESC NULLS LAST)
        FROM (
            SELECT tenant_id, student_id, latest_score, latest_activity_at
            FROM analytics.placement_student_rollups
            WHERE placement_department_id = v_track
              AND latest_score IS NOT NULL
            ORDER BY latest_score DESC NULLS LAST, latest_activity_at DESC NULLS LAST
            LIMIT LEAST(COALESCE(p_limit, 50), 200)
        ) AS r
    ), '[]'::jsonb);
END
$function$;

REVOKE ALL ON FUNCTION analytics.create_consortium_drive(uuid, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.list_consortium_drives(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.consortium_drive_leaderboard(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics.create_consortium_drive(uuid, text, timestamptz, timestamptz) TO aether_analytics_app;
GRANT EXECUTE ON FUNCTION analytics.list_consortium_drives(uuid) TO aether_analytics_app;
GRANT EXECUTE ON FUNCTION analytics.consortium_drive_leaderboard(uuid, integer) TO aether_analytics_app;

RESET ROLE;