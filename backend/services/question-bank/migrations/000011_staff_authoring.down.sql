SET ROLE aether_question_bank_owner;

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
    platform_expires_at timestamptz;
    has_platform boolean := false;
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
            platform_expires_at := parsed_expires_at;
        ELSIF parsed_kind = 'tenant' AND parsed_tenant_id IS NOT NULL AND parsed_tenant_id = parsed_source_id THEN
            CONTINUE;
        ELSIF parsed_kind = 'placement' AND parsed_tenant_id IS NOT NULL AND parsed_source_id IS NOT NULL THEN
            CONTINUE;
        ELSE
            RAISE EXCEPTION 'authorization grant has an invalid scope';
        END IF;
    END LOOP;
    PERFORM authz.apply_global_authorization(
        p_actor_id, p_authz_revision, has_platform, has_platform, has_platform, platform_expires_at
    );
    RETURN true;
END
$function$;

RESET ROLE;
