-- File: services/assessment/migrations/000012_soft_delete_schema.up.sql
SET ROLE aether_assessment_owner;

-- Exams
ALTER TABLE assessment.exams
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX exams_deleted_at_idx ON assessment.exams (deleted_at) WHERE deleted_at IS NOT NULL;

-- Exam versions
ALTER TABLE assessment.exam_versions
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX exam_versions_deleted_at_idx ON assessment.exam_versions (deleted_at) WHERE deleted_at IS NOT NULL;

-- Candidate Assignments
ALTER TABLE assessment.candidate_assignments
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX candidate_assignments_deleted_at_idx ON assessment.candidate_assignments (deleted_at) WHERE deleted_at IS NOT NULL;

-- Hard delete function
CREATE TABLE IF NOT EXISTS app.hard_delete_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name text NOT NULL,
    record_id uuid NOT NULL,
    deleted_by uuid NOT NULL,
    deletion_reason text NOT NULL CHECK (char_length(deletion_reason) > 0),
    deleted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX hard_delete_audit_log_table_idx ON app.hard_delete_audit_log (table_name, deleted_at DESC);

CREATE OR REPLACE FUNCTION app.hard_delete(
    p_table text, p_id uuid, p_actor uuid, p_reason text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_schema text;
    v_table text;
    v_sql text;
BEGIN
    -- Validate inputs
    IF p_table IS NULL OR p_id IS NULL OR p_actor IS NULL OR coalesce(p_reason, '') = '' THEN
        RAISE EXCEPTION 'hard_delete: all parameters required (table, id, actor, reason)';
    END IF;

    -- Validate schema-qualified table format
    v_schema := split_part(p_table, '.', 1);
    v_table := split_part(p_table, '.', 2);
    IF v_schema = '' OR v_table = '' OR split_part(p_table, '.', 3) <> '' THEN
        RAISE EXCEPTION 'hard_delete: p_table must be schema-qualified (schema.table), got: %', p_table;
    END IF;

    -- Authorization note: app-layer Casbin check verifies super_admin before calling.
    -- This function is GRANT EXECUTE only to the service app role — no other roles can invoke it.
    -- The SECURITY DEFINER context bypasses RLS block_delete policies.

    -- Audit the hard delete
    INSERT INTO app.hard_delete_audit_log (table_name, record_id, deleted_by, deletion_reason, deleted_at)
    VALUES (p_table, p_id, p_actor, p_reason, clock_timestamp());

    -- Execute physical delete with properly quoted schema.table
    v_sql := format('DELETE FROM %I.%I WHERE id = $1', v_schema, v_table);
    EXECUTE v_sql USING p_id;

    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION app.hard_delete TO aether_assessment_app;
