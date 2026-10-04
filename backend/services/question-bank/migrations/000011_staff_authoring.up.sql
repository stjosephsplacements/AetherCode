SET ROLE aether_question_bank_owner;

-- ADR-0020: college staff author into the global bank. A tenant grant marked
-- "authoring" (college_admin or department_user) gives the same global read
-- and write as a platform grant. This is the resync path; the live projection
-- consumer applies the same rule in Go.
CREATE OR REPLACE FUNCTION authz.apply_authorization_snapshot(
    p_actor_id uuid, p_authz_revision bigint, p_grants jsonb
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
DECLARE
    grant_item jsonb;
    parsed_kind text;
    parsed_tenant_id uuid;
    parsed_source_id uuid;
    parsed_expires_at timestamptz;
    has_platform boolean := false;
    has_global boolean := false;
    global_expires_at timestamptz;
    current_revision bigint;
BEGIN
    IF p_actor_id IS NULL OR p_authz_revision <= 0 OR jsonb_typeof(p_grants) <> 'array' THEN
        RAISE EXCEPTION 'principal, positive authorization revision, and grants array are required';
    END IF;
    SELECT authorization_row.authz_revision INTO current_revision
    FROM authz.actor_global_authorizations AS authorization_row
    WHERE authorization_row.actor_id = p_actor_id FOR UPDATE;
    IF FOUND AND current_revision >= p_authz_revision THEN RETURN false; END IF;
    FOR grant_item IN SELECT value FROM jsonb_array_elements(p_grants) LOOP
        IF jsonb_typeof(grant_item) <> 'object' THEN
            RAISE EXCEPTION 'authorization grant must be an object';
        END IF;
        parsed_kind := grant_item ->> 'grant_kind';
        BEGIN
            parsed_tenant_id := NULLIF(grant_item ->> 'tenant_id', '')::uuid;
            parsed_source_id := NULLIF(grant_item ->> 'grant_source_id', '')::uuid;
            parsed_expires_at := NULLIF(grant_item ->> 'expires_at', '')::timestamptz;
        EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
            RAISE EXCEPTION 'authorization grant contains an invalid UUID or timestamp';
        END;
        IF parsed_kind = 'platform'
           AND parsed_tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
           AND parsed_source_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
            IF has_platform THEN RAISE EXCEPTION 'authorization snapshot contains duplicate grants'; END IF;
            has_platform := true;
        ELSIF parsed_kind = 'tenant' AND parsed_tenant_id IS NOT NULL AND parsed_tenant_id = parsed_source_id THEN
            IF NOT COALESCE((grant_item ->> 'authoring')::boolean, false) THEN
                CONTINUE;
            END IF;
        ELSIF parsed_kind = 'placement' AND parsed_tenant_id IS NOT NULL AND parsed_source_id IS NOT NULL THEN
            CONTINUE;
        ELSE
            RAISE EXCEPTION 'authorization grant has an invalid scope';
        END IF;
        IF parsed_kind <> 'tenant' AND (grant_item ? 'authoring') THEN
            RAISE EXCEPTION 'only a tenant authorization grant may carry authoring';
        END IF;
        IF parsed_kind <> 'placement' THEN
            -- A platform grant or a staff authoring grant: global access, and
            -- a grant that never expires outlasts every expiring one.
            global_expires_at := CASE
                WHEN NOT has_global THEN parsed_expires_at
                WHEN global_expires_at IS NULL OR parsed_expires_at IS NULL THEN NULL
                ELSE greatest(global_expires_at, parsed_expires_at)
            END;
            has_global := true;
        END IF;
    END LOOP;
    PERFORM authz.apply_global_authorization(
        p_actor_id, p_authz_revision, has_global, has_global, has_global, global_expires_at
    );
    RETURN true;
END
$function$;

RESET ROLE;
