-- Talent cards (ADR-0081). A card is a signed claim set a recruiter can verify without a
-- login. Analytics keeps only the consent and the card's validity; the signed token
-- carries the claims. Every access goes through the functions below.
SET ROLE aether_analytics_owner;

CREATE TABLE analytics.talent_card_consents (
    tenant_id uuid NOT NULL,
    student_id uuid NOT NULL,
    granted boolean NOT NULL,
    share_contact_info boolean NOT NULL DEFAULT false,
    blind_evaluation boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, student_id)
);

CREATE TABLE analytics.talent_cards (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    student_id uuid NOT NULL,
    issued_by uuid NOT NULL,
    issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CHECK (expires_at > issued_at)
);
CREATE INDEX talent_cards_student_idx ON analytics.talent_cards (tenant_id, student_id);

DO $rls$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['analytics.talent_card_consents', 'analytics.talent_cards'] LOOP
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format('CREATE POLICY %I ON %s FOR ALL TO aether_analytics_owner USING (true) WITH CHECK (true)',
                       replace(table_name, '.', '_') || '_owner', table_name);
        EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC', table_name);
    END LOOP;
END
$rls$;

-- A student's own consent. Withdrawing it revokes every card already issued.
CREATE FUNCTION analytics.set_talent_card_consent(
    p_tenant_id uuid, p_student_id uuid, p_granted boolean, p_share_contact_info boolean, p_blind_evaluation boolean
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, authz, analytics
AS $function$
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'analytics.write', 'analytics.talent_card_consents')
       OR authz.current_context_actor_id() IS DISTINCT FROM p_student_id THEN
        RAISE EXCEPTION 'signed authorization context does not allow changing this consent' USING ERRCODE = '42501';
    END IF;
    IF p_granted IS NULL OR p_share_contact_info IS NULL OR p_blind_evaluation IS NULL THEN
        RAISE EXCEPTION 'consent fields are required' USING ERRCODE = '22023';
    END IF;
    INSERT INTO analytics.talent_card_consents AS consent
        (tenant_id, student_id, granted, share_contact_info, blind_evaluation)
    VALUES (p_tenant_id, p_student_id, p_granted, p_share_contact_info AND p_granted, p_blind_evaluation)
    ON CONFLICT (tenant_id, student_id) DO UPDATE
    SET granted = EXCLUDED.granted, share_contact_info = EXCLUDED.share_contact_info,
        blind_evaluation = EXCLUDED.blind_evaluation, updated_at = clock_timestamp();
    IF NOT p_granted THEN
        UPDATE analytics.talent_cards SET revoked_at = clock_timestamp()
        WHERE tenant_id = p_tenant_id AND student_id = p_student_id AND revoked_at IS NULL;
    END IF;
END
$function$;

CREATE FUNCTION analytics.get_talent_card_consent(p_tenant_id uuid, p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, authz, analytics
AS $function$
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'analytics.read', 'analytics.talent_card_consents')
       OR authz.current_context_actor_id() IS DISTINCT FROM p_student_id THEN
        RAISE EXCEPTION 'signed authorization context does not allow reading this consent' USING ERRCODE = '42501';
    END IF;
    RETURN COALESCE((
        SELECT pg_catalog.jsonb_build_object('granted', consent.granted,
               'share_contact_info', consent.share_contact_info, 'blind_evaluation', consent.blind_evaluation)
        FROM analytics.talent_card_consents AS consent
        WHERE consent.tenant_id = p_tenant_id AND consent.student_id = p_student_id
    ), pg_catalog.jsonb_build_object('granted', false, 'share_contact_info', false, 'blind_evaluation', false));
END
$function$;

-- The figures a card attests, from the gold projections: the median of the student's
-- per-exam rank in their college cohort (top X percent), the share of finished
-- evaluations accepted, and a speed index. The index is the average share of the
-- attempt window left unused at submission, from 0 to 100; Analytics holds the window
-- (assignment open to close), not each exam's own duration, so it is a window-based
-- approximation until the duration is projected.
CREATE FUNCTION analytics.talent_card_metrics(p_tenant_id uuid, p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, authz, analytics
AS $function$
DECLARE
    consent analytics.talent_card_consents%ROWTYPE;
    exam_count integer;
    top_percent integer;
    accepted_count integer;
    evaluation_count integer;
    speed integer;
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'analytics.write', 'analytics.talent_cards') THEN
        RAISE EXCEPTION 'signed authorization context does not allow issuing talent cards' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO consent FROM analytics.talent_card_consents
    WHERE tenant_id = p_tenant_id AND student_id = p_student_id;
    IF NOT FOUND OR NOT consent.granted THEN
        RAISE EXCEPTION 'the student has not agreed to a talent card' USING ERRCODE = 'P0001';
    END IF;

    WITH mine AS (
        SELECT result.exam_version_id, result.score / result.maximum_score AS ratio
        FROM analytics.exam_result_rollups AS result
        WHERE result.tenant_id = p_tenant_id AND result.candidate_id = p_student_id
          AND result.lifecycle_state = 'graded' AND result.maximum_score > 0
    ), ranked AS (
        SELECT mine.exam_version_id,
               (SELECT count(*) FROM analytics.exam_result_rollups AS other
                 WHERE other.tenant_id = p_tenant_id AND other.exam_version_id = mine.exam_version_id
                   AND other.lifecycle_state = 'graded' AND other.maximum_score > 0
                   AND other.score / other.maximum_score > mine.ratio) AS better,
               (SELECT count(*) FROM analytics.exam_result_rollups AS other
                 WHERE other.tenant_id = p_tenant_id AND other.exam_version_id = mine.exam_version_id
                   AND other.lifecycle_state = 'graded' AND other.maximum_score > 0) AS cohort
        FROM mine
    )
    SELECT count(*)::integer,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY ceil(100.0 * (better + 1) / cohort))::integer
    INTO exam_count, top_percent
    FROM ranked;
    IF exam_count = 0 THEN
        RAISE EXCEPTION 'the student has no graded results' USING ERRCODE = 'P0001';
    END IF;

    SELECT count(*) FILTER (WHERE evaluation.verdict = 'accepted')::integer, count(*)::integer
    INTO accepted_count, evaluation_count
    FROM analytics.evaluation_projections AS evaluation
    JOIN analytics.attempt_projections AS attempt
      ON attempt.tenant_id = evaluation.tenant_id AND attempt.attempt_id = evaluation.attempt_id
    WHERE evaluation.tenant_id = p_tenant_id AND attempt.candidate_id = p_student_id
      AND evaluation.verdict IS NOT NULL AND evaluation.verdict NOT IN ('cancelled', 'internal_error');

    SELECT round(avg(100 * greatest(0, least(1, 1 - extract(epoch FROM attempt.completed_at - started.started_at)
                                              / extract(epoch FROM assignment.available_until - started.started_at)))))::integer
    INTO speed
    FROM analytics.attempt_projections AS attempt
    JOIN analytics.attempt_started_projections AS started
      ON started.tenant_id = attempt.tenant_id AND started.attempt_id = attempt.attempt_id
    JOIN analytics.candidate_assignment_projections AS assignment
      ON assignment.tenant_id = attempt.tenant_id AND assignment.candidate_assignment_id = attempt.candidate_assignment_id
    WHERE attempt.tenant_id = p_tenant_id AND attempt.candidate_id = p_student_id
      AND assignment.available_until > started.started_at;

    RETURN pg_catalog.jsonb_build_object(
        'exam_count', exam_count,
        'top_percent', top_percent,
        'accuracy', CASE WHEN evaluation_count > 0 THEN round(accepted_count::numeric / evaluation_count, 4) END,
        'evaluations', evaluation_count,
        'speed_index', speed,
        'share_contact_info', consent.share_contact_info,
        'blind_evaluation', consent.blind_evaluation
    );
END
$function$;

CREATE FUNCTION analytics.store_talent_card(p_id uuid, p_tenant_id uuid, p_student_id uuid, p_expires_at timestamptz)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, authz, analytics
AS $function$
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'analytics.write', 'analytics.talent_cards') THEN
        RAISE EXCEPTION 'signed authorization context does not allow issuing talent cards' USING ERRCODE = '42501';
    END IF;
    INSERT INTO analytics.talent_cards (id, tenant_id, student_id, issued_by, expires_at)
    VALUES (p_id, p_tenant_id, p_student_id, authz.current_context_actor_id(), p_expires_at);
END
$function$;

CREATE FUNCTION analytics.revoke_talent_card(p_tenant_id uuid, p_card_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, authz, analytics
AS $function$
DECLARE
    revoked integer;
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'analytics.write', 'analytics.talent_cards') THEN
        RAISE EXCEPTION 'signed authorization context does not allow revoking talent cards' USING ERRCODE = '42501';
    END IF;
    UPDATE analytics.talent_cards SET revoked_at = clock_timestamp()
    WHERE id = p_card_id AND tenant_id = p_tenant_id AND revoked_at IS NULL;
    GET DIAGNOSTICS revoked = ROW_COUNT;
    RETURN revoked > 0;
END
$function$;

-- Public: asked by the verification endpoint, which has no caller to authorize. It
-- discloses only whether a card id is still good.
CREATE FUNCTION analytics.talent_card_is_valid(p_card_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, analytics
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM analytics.talent_cards AS card
        JOIN analytics.talent_card_consents AS consent
          ON consent.tenant_id = card.tenant_id AND consent.student_id = card.student_id
        WHERE card.id = p_card_id AND card.revoked_at IS NULL AND card.expires_at > clock_timestamp()
          AND consent.granted
    )
$function$;

REVOKE ALL ON FUNCTION analytics.set_talent_card_consent(uuid, uuid, boolean, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.get_talent_card_consent(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.talent_card_metrics(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.store_talent_card(uuid, uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.revoke_talent_card(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.talent_card_is_valid(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics.set_talent_card_consent(uuid, uuid, boolean, boolean, boolean) TO aether_analytics_app;
GRANT EXECUTE ON FUNCTION analytics.get_talent_card_consent(uuid, uuid) TO aether_analytics_app;
GRANT EXECUTE ON FUNCTION analytics.talent_card_metrics(uuid, uuid) TO aether_analytics_app;
GRANT EXECUTE ON FUNCTION analytics.store_talent_card(uuid, uuid, uuid, timestamptz) TO aether_analytics_app;
GRANT EXECUTE ON FUNCTION analytics.revoke_talent_card(uuid, uuid) TO aether_analytics_app;
GRANT EXECUTE ON FUNCTION analytics.talent_card_is_valid(uuid) TO aether_analytics_app;

RESET ROLE;
