SET ROLE aether_tenant_owner;

CREATE TABLE tenant.branding (
    tenant_id uuid REFERENCES tenant.tenants (id) ON DELETE CASCADE,
    app_name text NOT NULL DEFAULT '' CHECK (char_length(app_name) <= 60),
    accent_color text CHECK (
        accent_color IS NULL
        OR accent_color ~ '^#[0-9a-fA-F]{6}$'
    ),
    updated_by uuid,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT branding_scope_check CHECK (
        (tenant_id IS NULL) OR (tenant_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX branding_tenant_id_key ON tenant.branding (tenant_id) NULLS NOT DISTINCT;

CREATE TABLE tenant.branding_logos (
    id uuid PRIMARY KEY,
    tenant_id uuid REFERENCES tenant.tenants (id) ON DELETE CASCADE,
    object_key text NOT NULL CHECK (char_length(object_key) BETWEEN 1 AND 512),
    sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
    content_type text NOT NULL CHECK (content_type IN (
        'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'
    )),
    position smallint NOT NULL CHECK (position BETWEEN 0 AND 4),
    alt_text text NOT NULL DEFAULT '' CHECK (char_length(alt_text) <= 200),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT branding_logos_scope_check CHECK (tenant_id IS NOT NULL OR tenant_id IS NULL)
);

CREATE UNIQUE INDEX branding_logos_scope_position_key
    ON tenant.branding_logos (tenant_id, position);

CREATE INDEX branding_logos_tenant_idx ON tenant.branding_logos (tenant_id, position);

CREATE TRIGGER branding_touch_updated_at BEFORE UPDATE ON tenant.branding
    FOR EACH ROW EXECUTE FUNCTION tenant.touch_updated_at();

ALTER TABLE tenant.branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.branding FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.branding_logos ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.branding_logos FORCE ROW LEVEL SECURITY;

CREATE POLICY branding_app_read ON tenant.branding FOR SELECT TO aether_tenant_app
    USING (
        (tenant_id IS NOT NULL AND (
            authz.current_context_allows(tenant_id, 'tenant.read', 'tenant.branding')
            OR authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.branding')
        ))
        OR (tenant_id IS NULL AND (
            authz.current_global_context_allows('tenant.read', 'tenant.branding')
            OR authz.current_global_context_allows('tenant.write', 'tenant.branding')
        ))
    );

CREATE POLICY branding_app_insert ON tenant.branding FOR INSERT TO aether_tenant_app
    WITH CHECK (
        (tenant_id IS NOT NULL AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.branding'))
        OR (tenant_id IS NULL AND authz.current_global_context_allows('tenant.write', 'tenant.branding'))
    );

CREATE POLICY branding_app_update ON tenant.branding FOR UPDATE TO aether_tenant_app
    USING (
        (tenant_id IS NOT NULL AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.branding'))
        OR (tenant_id IS NULL AND authz.current_global_context_allows('tenant.write', 'tenant.branding'))
    )
    WITH CHECK (
        (tenant_id IS NOT NULL AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.branding'))
        OR (tenant_id IS NULL AND authz.current_global_context_allows('tenant.write', 'tenant.branding'))
    );

CREATE POLICY branding_app_delete ON tenant.branding FOR DELETE TO aether_tenant_app
    USING (
        (tenant_id IS NOT NULL AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.branding'))
        OR (tenant_id IS NULL AND authz.current_global_context_allows('tenant.write', 'tenant.branding'))
    );

CREATE POLICY branding_logos_app_read ON tenant.branding_logos FOR SELECT TO aether_tenant_app
    USING (
        (tenant_id IS NOT NULL AND (
            authz.current_context_allows(tenant_id, 'tenant.read', 'tenant.branding')
            OR authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.branding')
        ))
        OR (tenant_id IS NULL AND (
            authz.current_global_context_allows('tenant.read', 'tenant.branding')
            OR authz.current_global_context_allows('tenant.write', 'tenant.branding')
        ))
    );

CREATE POLICY branding_logos_app_insert ON tenant.branding_logos FOR INSERT TO aether_tenant_app
    WITH CHECK (
        (tenant_id IS NOT NULL AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.branding'))
        OR (tenant_id IS NULL AND authz.current_global_context_allows('tenant.write', 'tenant.branding'))
    );

CREATE POLICY branding_logos_app_update ON tenant.branding_logos FOR UPDATE TO aether_tenant_app
    USING (
        (tenant_id IS NOT NULL AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.branding'))
        OR (tenant_id IS NULL AND authz.current_global_context_allows('tenant.write', 'tenant.branding'))
    )
    WITH CHECK (
        (tenant_id IS NOT NULL AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.branding'))
        OR (tenant_id IS NULL AND authz.current_global_context_allows('tenant.write', 'tenant.branding'))
    );

CREATE POLICY branding_logos_app_delete ON tenant.branding_logos FOR DELETE TO aether_tenant_app
    USING (
        (tenant_id IS NOT NULL AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.branding'))
        OR (tenant_id IS NULL AND authz.current_global_context_allows('tenant.write', 'tenant.branding'))
    );

CREATE POLICY branding_owner_maintenance ON tenant.branding FOR ALL TO aether_tenant_owner USING (true) WITH CHECK (true);
CREATE POLICY branding_logos_owner_maintenance ON tenant.branding_logos FOR ALL TO aether_tenant_owner USING (true) WITH CHECK (true);

-- Public reads merge college overrides with the platform default; no signed context required.
CREATE FUNCTION tenant.public_branding(p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, tenant AS $function$
DECLARE
    platform_name text;
    platform_color text;
    college_name text;
    college_color text;
    resolved_name text;
    resolved_color text;
    logo_scope uuid;
    logos jsonb;
BEGIN
    SELECT app_name, accent_color
      INTO platform_name, platform_color
      FROM tenant.branding
      WHERE tenant_id IS NULL;

    IF p_tenant_id IS NOT NULL THEN
        SELECT app_name, accent_color
          INTO college_name, college_color
          FROM tenant.branding
          WHERE tenant_id = p_tenant_id;
    END IF;

    resolved_name := NULLIF(trim(COALESCE(college_name, platform_name, '')), '');
    resolved_color := COALESCE(college_color, platform_color);

    logo_scope := p_tenant_id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', id::text,
               'content_type', content_type,
               'position', position,
               'alt_text', alt_text
           ) ORDER BY position), '[]'::jsonb)
      INTO logos
      FROM (
          SELECT id, content_type, position, alt_text
            FROM tenant.branding_logos
           WHERE tenant_id IS NOT DISTINCT FROM logo_scope
           ORDER BY position
           LIMIT 5
      ) scoped;
    IF logos = '[]'::jsonb AND p_tenant_id IS NOT NULL THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'id', id::text,
                   'content_type', content_type,
                   'position', position,
                   'alt_text', alt_text
               ) ORDER BY position), '[]'::jsonb)
          INTO logos
          FROM (
              SELECT id, content_type, position, alt_text
                FROM tenant.branding_logos
               WHERE tenant_id IS NULL
               ORDER BY position
               LIMIT 5
          ) fallback;
    END IF;

    RETURN jsonb_build_object(
        'app_name', resolved_name,
        'accent_color', resolved_color,
        'logos', logos
    );
END
$function$;

CREATE FUNCTION tenant.public_branding_logo(p_logo_id uuid)
RETURNS TABLE (
    tenant_id uuid,
    object_key text,
    content_type text,
    sha256 bytea
) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, tenant AS $function$
    SELECT tenant_id, object_key, content_type, sha256
    FROM tenant.branding_logos
    WHERE id = p_logo_id
$function$;

REVOKE ALL ON FUNCTION tenant.public_branding(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant.public_branding_logo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant.public_branding(uuid) TO aether_tenant_app;
GRANT EXECUTE ON FUNCTION tenant.public_branding_logo(uuid) TO aether_tenant_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.branding, tenant.branding_logos TO aether_tenant_app;

RESET ROLE;