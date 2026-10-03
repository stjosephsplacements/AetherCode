SET ROLE aether_user_owner;

-- Profiles
ALTER TABLE users.profiles
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX profiles_deleted_at_idx ON users.profiles (deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Students (already has status field, add soft delete)
ALTER TABLE users.students
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX students_deleted_at_idx ON users.students (deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Role assignments
ALTER TABLE users.role_assignments
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX role_assignments_deleted_at_idx ON users.role_assignments (deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Mentor batch assignments
ALTER TABLE users.mentor_batch_assignments
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX mentor_batch_assignments_deleted_at_idx ON users.mentor_batch_assignments (deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Student department memberships
ALTER TABLE users.student_department_memberships
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid,
    ADD COLUMN deletion_reason text;

CREATE INDEX student_department_memberships_deleted_at_idx ON users.student_department_memberships (deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Cascade soft delete trigger: when student soft-deleted, mark department memberships
CREATE OR REPLACE FUNCTION users.cascade_student_soft_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        -- Student was just soft-deleted, cascade to department memberships
        UPDATE users.student_department_memberships
        SET deleted_at = NEW.deleted_at,
            deleted_by = NEW.deleted_by,
            deletion_reason = 'Cascaded from student soft delete'
        WHERE student_id = NEW.id
          AND deleted_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER cascade_student_soft_delete_trigger
    AFTER UPDATE OF deleted_at ON users.students
    FOR EACH ROW
    EXECUTE FUNCTION users.cascade_student_soft_delete();

-- Hard delete audit log
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
    p_table text,
    p_id uuid,
    p_actor uuid,
    p_reason text
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
    INSERT INTO app.hard_delete_audit_log (
        table_name, record_id, deleted_by, deletion_reason, deleted_at
    ) VALUES (
        p_table, p_id, p_actor, p_reason, clock_timestamp()
    );

    -- Execute physical delete with properly quoted schema.table
    v_sql := format('DELETE FROM %I.%I WHERE id = $1', v_schema, v_table);
    EXECUTE v_sql USING p_id;

    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION app.hard_delete TO aether_user_app;

RESET ROLE;
