-- 000012 stamped email_verified_at with CURRENT_TIMESTAMP (transaction start)
-- while created_at defaults to clock_timestamp() (later), so the row violated
-- CHECK (email_verified_at >= created_at) and bootstrap always failed. One
-- clock reading now stamps all three columns.
SET ROLE aether_identity_owner;

CREATE OR REPLACE FUNCTION identity.bootstrap_first_principal(
    p_principal_id uuid,
    p_email text,
    p_display_name text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, identity
AS $function$
DECLARE
    existing_id uuid;
    created timestamptz := clock_timestamp();
BEGIN
    -- Idempotent: bootstrap spans two databases with no distributed
    -- transaction, so re-running after a partial failure must succeed.
    SELECT id INTO existing_id
    FROM identity.principals
    WHERE lower(email) = lower(btrim(p_email)) AND deleted_at IS NULL;
    IF existing_id IS NOT NULL THEN
        RETURN existing_id;
    END IF;

    IF EXISTS (SELECT 1 FROM identity.principals WHERE deleted_at IS NULL) THEN
        RAISE EXCEPTION 'platform already has principals; bootstrap is closed'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO identity.principals (id, email, display_name, status, email_verified_at, created_at, updated_at)
    VALUES (p_principal_id, btrim(p_email), btrim(p_display_name), 'active', created, created, created);

    RETURN p_principal_id;
END
$function$;

RESET ROLE;
