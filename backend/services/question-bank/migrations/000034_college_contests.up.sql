-- College-scoped practice contests (ADR-0091).
SET ROLE aether_question_bank_owner;

CREATE TABLE qbank.college_contests (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    description text NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
    question_ids uuid[] NOT NULL CHECK (cardinality(question_ids) BETWEEN 1 AND 20),
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX college_contests_tenant_idx ON qbank.college_contests (tenant_id, starts_at DESC);

CREATE TABLE qbank.college_contest_registrations (
    contest_id uuid NOT NULL REFERENCES qbank.college_contests (id) ON DELETE CASCADE,
    actor_id uuid NOT NULL,
    registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (contest_id, actor_id)
);

ALTER TABLE qbank.college_contests ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbank.college_contests FORCE ROW LEVEL SECURITY;
ALTER TABLE qbank.college_contest_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbank.college_contest_registrations FORCE ROW LEVEL SECURITY;
CREATE POLICY college_contests_owner ON qbank.college_contests FOR ALL TO aether_question_bank_owner USING (true) WITH CHECK (true);
CREATE POLICY college_contest_registrations_owner ON qbank.college_contest_registrations FOR ALL TO aether_question_bank_owner USING (true) WITH CHECK (true);

CREATE FUNCTION qbank.contest_lifecycle(p_starts_at timestamptz, p_ends_at timestamptz)
RETURNS text
LANGUAGE sql STABLE
AS $function$
    SELECT CASE
        WHEN clock_timestamp() < p_starts_at THEN 'scheduled'
        WHEN clock_timestamp() <= p_ends_at THEN 'live'
        ELSE 'ended'
    END
$function$;

CREATE FUNCTION qbank.list_college_contests(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz
AS $function$
DECLARE
    actor uuid;
    staff boolean;
BEGIN
    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'tenant is required' USING ERRCODE = '23514';
    END IF;
    actor := authz.current_context_actor_id();
    IF actor IS NULL THEN
        RAISE EXCEPTION 'no signed context' USING ERRCODE = '42501';
    END IF;
    staff := authz.current_context_allows(p_tenant_id, 'qbank.write', 'qbank.college_contests')
        OR authz.current_context_allows(p_tenant_id, 'qbank.read', 'qbank.college_contests');
    IF NOT staff AND NOT authz.current_context_allows(p_tenant_id, 'qbank.read', 'qbank.practice_submissions') THEN
        RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'id', contest.id::text,
                   'title', contest.title,
                   'description', contest.description,
                   'starts_at', contest.starts_at,
                   'ends_at', contest.ends_at,
                   'question_ids', to_jsonb(contest.question_ids),
                   'lifecycle', qbank.contest_lifecycle(contest.starts_at, contest.ends_at),
                   'registered', EXISTS (
                       SELECT 1 FROM qbank.college_contest_registrations AS reg
                       WHERE reg.contest_id = contest.id AND reg.actor_id = actor))
               ORDER BY contest.starts_at DESC)
        FROM qbank.college_contests AS contest
        WHERE contest.tenant_id = p_tenant_id
          AND (staff OR qbank.contest_lifecycle(contest.starts_at, contest.ends_at) <> 'ended'
               OR EXISTS (
                   SELECT 1 FROM qbank.college_contest_registrations AS reg
                   WHERE reg.contest_id = contest.id AND reg.actor_id = actor))
    ), '[]'::jsonb);
END
$function$;

CREATE FUNCTION qbank.save_college_contest(p_tenant_id uuid, p_id uuid, p_title text, p_description text, p_starts_at timestamptz, p_ends_at timestamptz, p_question_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz
AS $function$
DECLARE
    actor uuid;
    question_id uuid;
BEGIN
    IF NOT authz.current_context_allows(p_tenant_id, 'qbank.write', 'qbank.college_contests') THEN
        RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
    END IF;
    actor := authz.current_context_actor_id();
    IF p_ends_at <= p_starts_at THEN
        RAISE EXCEPTION 'ends_at must be after starts_at' USING ERRCODE = '22023';
    END IF;
    FOREACH question_id IN ARRAY p_question_ids LOOP
        IF NOT EXISTS (
            SELECT 1 FROM qbank.questions AS question
            WHERE question.id = question_id AND question.audience = 'practice' AND question.deleted_at IS NULL
        ) THEN
            RAISE EXCEPTION 'every contest problem must be a practice question' USING ERRCODE = '22023';
        END IF;
    END LOOP;
    INSERT INTO qbank.college_contests (id, tenant_id, title, description, starts_at, ends_at, question_ids, created_by)
    VALUES (p_id, p_tenant_id, btrim(p_title), COALESCE(p_description, ''), p_starts_at, p_ends_at, p_question_ids, actor)
    ON CONFLICT (id) DO UPDATE
        SET title = EXCLUDED.title,
            description = EXCLUDED.description,
            starts_at = EXCLUDED.starts_at,
            ends_at = EXCLUDED.ends_at,
            question_ids = EXCLUDED.question_ids
    WHERE qbank.college_contests.tenant_id = p_tenant_id;
    RETURN jsonb_build_object('id', p_id::text);
END
$function$;

CREATE FUNCTION qbank.register_college_contest(p_tenant_id uuid, p_contest_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz
AS $function$
DECLARE
    actor uuid;
    contest qbank.college_contests%ROWTYPE;
BEGIN
    PERFORM qbank.require_practice_context(false);
    actor := authz.current_context_actor_id();
    SELECT * INTO contest FROM qbank.college_contests
    WHERE id = p_contest_id AND tenant_id = p_tenant_id;
    IF contest.id IS NULL THEN
        RAISE EXCEPTION 'contest was not found' USING ERRCODE = 'P0002';
    END IF;
    IF qbank.contest_lifecycle(contest.starts_at, contest.ends_at) = 'ended' THEN
        RAISE EXCEPTION 'contest has ended' USING ERRCODE = '22023';
    END IF;
    INSERT INTO qbank.college_contest_registrations (contest_id, actor_id)
    VALUES (contest.id, actor)
    ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('registered', true);
END
$function$;

CREATE FUNCTION qbank.college_contest_leaderboard(p_tenant_id uuid, p_contest_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz
AS $function$
DECLARE
    contest qbank.college_contests%ROWTYPE;
BEGIN
    SELECT * INTO contest FROM qbank.college_contests
    WHERE id = p_contest_id AND tenant_id = p_tenant_id;
    IF contest.id IS NULL THEN
        RAISE EXCEPTION 'contest was not found' USING ERRCODE = 'P0002';
    END IF;
  IF NOT (
        authz.current_context_allows(p_tenant_id, 'qbank.read', 'qbank.college_contests')
        OR authz.current_context_allows(p_tenant_id, 'qbank.read', 'qbank.practice_submissions')
    ) THEN
        RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
    END IF;
    RETURN COALESCE((
        WITH solved AS (
            SELECT submission.actor_id,
                   count(DISTINCT submission.question_id) AS problems,
                   max(submission.completed_at) AS last_solve
            FROM qbank.practice_submissions AS submission
            WHERE submission.tenant_id = p_tenant_id
              AND submission.question_id = ANY (contest.question_ids)
              AND submission.mode = 'submit'
              AND submission.verdict = 'accepted'
              AND submission.lifecycle_state = 'completed'
              AND submission.completed_at BETWEEN contest.starts_at AND contest.ends_at
            GROUP BY submission.actor_id
        )
        SELECT jsonb_agg(jsonb_build_object(
                   'actor_id', solved.actor_id::text,
                   'problems', solved.problems,
                   'last_solve', solved.last_solve)
               ORDER BY solved.problems DESC, solved.last_solve ASC)
        FROM solved
    ), '[]'::jsonb);
END
$function$;

REVOKE ALL ON FUNCTION qbank.list_college_contests(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.save_college_contest(uuid, uuid, text, text, timestamptz, timestamptz, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.register_college_contest(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION qbank.college_contest_leaderboard(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qbank.list_college_contests(uuid) TO aether_question_bank_app;
GRANT EXECUTE ON FUNCTION qbank.save_college_contest(uuid, uuid, text, text, timestamptz, timestamptz, uuid[]) TO aether_question_bank_app;
GRANT EXECUTE ON FUNCTION qbank.register_college_contest(uuid, uuid) TO aether_question_bank_app;
GRANT EXECUTE ON FUNCTION qbank.college_contest_leaderboard(uuid, uuid) TO aether_question_bank_app;

RESET ROLE;