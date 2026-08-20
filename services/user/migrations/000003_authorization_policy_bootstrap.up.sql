-- Canonical Casbin policy rows are controlled security configuration. They are
-- seeded with stable UUIDv7 identifiers before the first production release;
-- later policy changes synchronously advance affected principals' revisions.
SET ROLE aether_user_owner;

CREATE OR REPLACE FUNCTION users.bump_revisions_for_policy_role(p_role_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, users
AS $function$
DECLARE
    principal_record record;
BEGIN
    IF p_role_name IS NULL OR p_role_name !~ '^[a-z][a-z0-9_]{0,63}$' THEN
        RAISE EXCEPTION 'a valid role name is required for a policy revision bump';
    END IF;
    FOR principal_record IN
        SELECT DISTINCT assignment.principal_id
        FROM users.role_assignments AS assignment
        WHERE assignment.role_name = p_role_name
          AND assignment.status = 'active'
          AND (assignment.expires_at IS NULL OR assignment.expires_at > clock_timestamp())
    LOOP
        PERFORM users.bump_authz_revision(principal_record.principal_id, 'authorization_policy');
    END LOOP;
END
$function$;

CREATE OR REPLACE FUNCTION users.on_authorization_policy_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, users
AS $function$
DECLARE
    prior_role text;
    next_role text;
BEGIN
    prior_role := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.v0 END;
    next_role := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.v0 END;
    IF prior_role IS NOT NULL THEN
        PERFORM users.bump_revisions_for_policy_role(prior_role);
    END IF;
    IF next_role IS NOT NULL AND next_role IS DISTINCT FROM prior_role THEN
        PERFORM users.bump_revisions_for_policy_role(next_role);
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$function$;

CREATE TRIGGER authorization_policy_rules_bump_revisions
AFTER INSERT OR UPDATE OR DELETE ON users.authorization_policy_rules
FOR EACH ROW EXECUTE FUNCTION users.on_authorization_policy_change();

-- The model is r = role, scope_kind, object, action. Scope ownership and
-- relationship predicates remain typed SQL data; policy rows only define what
-- each role may do after its typed scope applies.
INSERT INTO users.authorization_policy_rules (id, ptype, v0, v1, v2, v3)
VALUES
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220001', 'p', 'super_admin', 'platform', '/*', '*'),
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220002', 'p', 'placement_user', 'platform', '/*', '*'),
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220003', 'p', 'placement_user', 'placement_department', '/students/:id', 'read'),
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220004', 'p', 'college_admin', 'college', '/*', '*'),
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220005', 'p', 'department_user', 'department', '/*', '*'),
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220006', 'p', 'mentor', 'department', '/*', 'read'),
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220007', 'p', 'mentor', 'batch', '/*', 'read'),
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220008', 'p', 'student', 'self', '/students/:id', 'read')
ON CONFLICT DO NOTHING;

-- Request-serving app connections may inspect neither policy configuration nor
-- mutate it. The central authorization reader has SELECT-only access.
REVOKE SELECT, INSERT, UPDATE, DELETE ON users.authorization_policy_rules FROM aether_user_app;
REVOKE ALL ON FUNCTION users.bump_revisions_for_policy_role(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION users.on_authorization_policy_change() FROM PUBLIC;

RESET ROLE;
