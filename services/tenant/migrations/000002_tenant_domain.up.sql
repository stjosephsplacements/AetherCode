SET ROLE aether_tenant_owner;

CREATE TABLE app.inbox_messages (
    consumer_name text NOT NULL CHECK (consumer_name ~ '^[a-z][a-z0-9._-]{0,127}$'),
    message_id uuid NOT NULL,
    subject text NOT NULL CHECK (subject ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'),
    occurred_at timestamptz NOT NULL,
    payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    processed_at timestamptz,
    failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    last_error text,
    PRIMARY KEY (consumer_name, message_id),
    CHECK (processed_at IS NULL OR processed_at >= received_at)
);
CREATE INDEX inbox_messages_pending_idx ON app.inbox_messages (received_at) WHERE processed_at IS NULL;

CREATE TABLE app.command_idempotency (
    command_scope text NOT NULL CHECK (command_scope ~ '^[a-z][a-z0-9._-]{0,127}$'),
    idempotency_key uuid NOT NULL,
    request_sha256 bytea NOT NULL CHECK (octet_length(request_sha256) = 32),
    response_code integer,
    response_body jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (command_scope, idempotency_key),
    CHECK (expires_at > created_at),
    CHECK ((completed_at IS NULL) = (response_code IS NULL)),
    CHECK (response_body IS NULL OR jsonb_typeof(response_body) = 'object')
);
CREATE INDEX command_idempotency_expiry_idx ON app.command_idempotency (expires_at);

CREATE TABLE app.outbox_events (
    event_id uuid PRIMARY KEY,
    aggregate_type text NOT NULL CHECK (aggregate_type ~ '^[a-z][a-z0-9._-]{0,127}$'),
    aggregate_id uuid NOT NULL,
    tenant_id uuid,
    event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9._-]{0,127}$'),
    schema_version integer NOT NULL CHECK (schema_version > 0),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    published_at timestamptz,
    publication_attempts integer NOT NULL DEFAULT 0 CHECK (publication_attempts >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    locked_until timestamptz,
    last_error text
);
CREATE INDEX outbox_events_pending_idx ON app.outbox_events (next_attempt_at, occurred_at) WHERE published_at IS NULL;

CREATE FUNCTION tenant.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
BEGIN
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END
$function$;

CREATE FUNCTION tenant.reject_tenant_move()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
BEGIN
    IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION 'tenant_id is immutable';
    END IF;
    RETURN NEW;
END
$function$;

CREATE TABLE tenant.tenants (
    id uuid PRIMARY KEY,
    slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    legal_name text NOT NULL CHECK (char_length(btrim(legal_name)) BETWEEN 1 AND 255),
    display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 255),
    status text NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'active', 'suspended', 'closed')),
    country_code char(2) NOT NULL DEFAULT 'IN' CHECK (country_code = 'IN'),
    timezone text NOT NULL DEFAULT 'Asia/Kolkata' CHECK (timezone = 'Asia/Kolkata'),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    closed_at timestamptz,
    CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX tenants_slug_unique ON tenant.tenants (lower(slug));

CREATE TABLE tenant.placement_organizations (
    id uuid PRIMARY KEY,
    code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,62}$'),
    legal_name text NOT NULL CHECK (char_length(btrim(legal_name)) BETWEEN 1 AND 255),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
    country_code char(2) NOT NULL DEFAULT 'IN' CHECK (country_code = 'IN'),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    closed_at timestamptz,
    CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX placement_organizations_code_unique ON tenant.placement_organizations (code);

CREATE TABLE tenant.departments (
    id uuid PRIMARY KEY,
    tenant_id uuid REFERENCES tenant.tenants (id) ON DELETE RESTRICT,
    placement_organization_id uuid REFERENCES tenant.placement_organizations (id) ON DELETE RESTRICT,
    department_type text NOT NULL CHECK (department_type IN ('college', 'placement')),
    code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$'),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 255),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (id, tenant_id),
    CHECK (
        (department_type = 'college' AND tenant_id IS NOT NULL AND placement_organization_id IS NULL)
        OR (department_type = 'placement' AND tenant_id IS NULL AND placement_organization_id IS NOT NULL)
    )
);
CREATE UNIQUE INDEX college_departments_code_unique
    ON tenant.departments (tenant_id, lower(code)) WHERE department_type = 'college';
CREATE UNIQUE INDEX placement_departments_code_unique
    ON tenant.departments (placement_organization_id, lower(code)) WHERE department_type = 'placement';
CREATE INDEX departments_tenant_idx ON tenant.departments (tenant_id) WHERE department_type = 'college';

CREATE TABLE tenant.batches (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenant.tenants (id) ON DELETE RESTRICT,
    department_id uuid NOT NULL,
    code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$'),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 255),
    academic_year text NOT NULL CHECK (academic_year ~ '^[0-9]{4}-[0-9]{4}$'),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (id, tenant_id),
    UNIQUE (tenant_id, department_id, code, academic_year),
    FOREIGN KEY (department_id, tenant_id)
        REFERENCES tenant.departments (id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX batches_tenant_idx ON tenant.batches (tenant_id, status);

CREATE TABLE tenant.retention_policies (
    tenant_id uuid PRIMARY KEY REFERENCES tenant.tenants (id) ON DELETE RESTRICT,
    academic_records_years smallint NOT NULL DEFAULT 7 CHECK (academic_records_years BETWEEN 7 AND 30),
    audit_records_years smallint NOT NULL DEFAULT 7 CHECK (audit_records_years BETWEEN 7 AND 30),
    auth_logs_days integer NOT NULL DEFAULT 365 CHECK (auth_logs_days BETWEEN 90 AND 3650),
    notification_delivery_days integer NOT NULL DEFAULT 90 CHECK (notification_delivery_days BETWEEN 30 AND 3650),
    execution_record_days integer NOT NULL DEFAULT 30 CHECK (execution_record_days BETWEEN 1 AND 365),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE tenant.legal_holds (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenant.tenants (id) ON DELETE RESTRICT,
    scope text NOT NULL CHECK (scope IN ('tenant', 'student', 'assessment', 'submission')),
    subject_id uuid,
    reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
    placed_by_principal_id uuid NOT NULL,
    placed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    released_by_principal_id uuid,
    released_at timestamptz,
    CHECK ((scope = 'tenant' AND subject_id IS NULL) OR (scope <> 'tenant' AND subject_id IS NOT NULL)),
    CHECK ((status = 'active' AND released_at IS NULL AND released_by_principal_id IS NULL)
        OR (status = 'released' AND released_at IS NOT NULL AND released_by_principal_id IS NOT NULL)),
    CHECK (released_at IS NULL OR released_at >= placed_at)
);
CREATE INDEX legal_holds_active_idx ON tenant.legal_holds (tenant_id, scope, subject_id) WHERE status = 'active';

CREATE TABLE tenant.provisioning_requests (
    id uuid PRIMARY KEY,
    idempotency_key uuid NOT NULL UNIQUE,
    requested_by_principal_id uuid NOT NULL,
    requested_tenant_id uuid,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'provisioned', 'failed', 'cancelled')),
    request_payload jsonb NOT NULL CHECK (jsonb_typeof(request_payload) = 'object'),
    failure_code text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz,
    CHECK ((status IN ('provisioned', 'failed', 'cancelled')) = (completed_at IS NOT NULL))
);

CREATE FUNCTION tenant.validate_batch_department()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, tenant AS $function$
DECLARE department_kind text;
BEGIN
    SELECT department_type INTO department_kind
    FROM tenant.departments
    WHERE id = NEW.department_id AND tenant_id = NEW.tenant_id;
    IF department_kind IS DISTINCT FROM 'college' THEN
        RAISE EXCEPTION 'batches may reference only a college department in the same tenant';
    END IF;
    RETURN NEW;
END
$function$;

CREATE FUNCTION tenant.reject_department_scope_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
BEGIN
    IF OLD.department_type IS DISTINCT FROM NEW.department_type
       OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR OLD.placement_organization_id IS DISTINCT FROM NEW.placement_organization_id THEN
        RAISE EXCEPTION 'department ownership and type are immutable';
    END IF;
    RETURN NEW;
END
$function$;

CREATE TRIGGER tenants_touch_updated_at BEFORE UPDATE ON tenant.tenants
FOR EACH ROW EXECUTE FUNCTION tenant.touch_updated_at();
CREATE TRIGGER placement_organizations_touch_updated_at BEFORE UPDATE ON tenant.placement_organizations
FOR EACH ROW EXECUTE FUNCTION tenant.touch_updated_at();
CREATE TRIGGER departments_touch_updated_at BEFORE UPDATE ON tenant.departments
FOR EACH ROW EXECUTE FUNCTION tenant.touch_updated_at();
CREATE TRIGGER batches_touch_updated_at BEFORE UPDATE ON tenant.batches
FOR EACH ROW EXECUTE FUNCTION tenant.touch_updated_at();
CREATE TRIGGER retention_policies_touch_updated_at BEFORE UPDATE ON tenant.retention_policies
FOR EACH ROW EXECUTE FUNCTION tenant.touch_updated_at();
CREATE TRIGGER batches_validate_department BEFORE INSERT OR UPDATE OF department_id, tenant_id ON tenant.batches
FOR EACH ROW EXECUTE FUNCTION tenant.validate_batch_department();
CREATE TRIGGER departments_reject_scope_change BEFORE UPDATE ON tenant.departments
FOR EACH ROW EXECUTE FUNCTION tenant.reject_department_scope_change();
CREATE TRIGGER batches_reject_tenant_move BEFORE UPDATE ON tenant.batches
FOR EACH ROW EXECUTE FUNCTION tenant.reject_tenant_move();
CREATE TRIGGER retention_policies_reject_tenant_move BEFORE UPDATE ON tenant.retention_policies
FOR EACH ROW EXECUTE FUNCTION tenant.reject_tenant_move();
CREATE TRIGGER legal_holds_reject_tenant_move BEFORE UPDATE ON tenant.legal_holds
FOR EACH ROW EXECUTE FUNCTION tenant.reject_tenant_move();

ALTER TABLE tenant.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.departments FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.batches FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.retention_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.legal_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.legal_holds FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.placement_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.placement_organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.provisioning_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.provisioning_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY tenants_app_read ON tenant.tenants FOR SELECT TO aether_tenant_app
    USING (
        authz.current_context_allows(id, 'tenant.read', 'tenant.tenants')
        OR authz.current_context_allows(id, 'tenant.write', 'tenant.tenants')
    );
CREATE POLICY tenants_app_insert ON tenant.tenants FOR INSERT TO aether_tenant_app
    WITH CHECK (authz.current_context_allows(id, 'tenant.write', 'tenant.tenants'));
CREATE POLICY tenants_app_update ON tenant.tenants FOR UPDATE TO aether_tenant_app
    USING (authz.current_context_allows(id, 'tenant.write', 'tenant.tenants'))
    WITH CHECK (authz.current_context_allows(id, 'tenant.write', 'tenant.tenants'));
CREATE POLICY tenants_app_delete ON tenant.tenants FOR DELETE TO aether_tenant_app
    USING (authz.current_context_allows(id, 'tenant.write', 'tenant.tenants'));

CREATE POLICY departments_app_read ON tenant.departments FOR SELECT TO aether_tenant_app
    USING (
        (department_type = 'college' AND (
            authz.current_context_allows(tenant_id, 'tenant.read', 'tenant.departments')
            OR authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.departments')
        ))
        OR (department_type = 'placement' AND (
            authz.current_context_allows_placement(id, 'tenant.read', 'tenant.departments')
            OR authz.current_context_allows_placement(id, 'tenant.write', 'tenant.departments')
        ))
    );
CREATE POLICY departments_app_insert ON tenant.departments FOR INSERT TO aether_tenant_app
    WITH CHECK (
        (department_type = 'college' AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.departments'))
        OR (department_type = 'placement' AND authz.current_context_allows_placement(id, 'tenant.write', 'tenant.departments'))
    );
CREATE POLICY departments_app_update ON tenant.departments FOR UPDATE TO aether_tenant_app
    USING (
        (department_type = 'college' AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.departments'))
        OR (department_type = 'placement' AND authz.current_context_allows_placement(id, 'tenant.write', 'tenant.departments'))
    ) WITH CHECK (
        (department_type = 'college' AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.departments'))
        OR (department_type = 'placement' AND authz.current_context_allows_placement(id, 'tenant.write', 'tenant.departments'))
    );
CREATE POLICY departments_app_delete ON tenant.departments FOR DELETE TO aether_tenant_app
    USING (
        (department_type = 'college' AND authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.departments'))
        OR (department_type = 'placement' AND authz.current_context_allows_placement(id, 'tenant.write', 'tenant.departments'))
    );

CREATE POLICY batches_app_read ON tenant.batches FOR SELECT TO aether_tenant_app
    USING (
        authz.current_context_allows(tenant_id, 'tenant.read', 'tenant.batches')
        OR authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.batches')
    );
CREATE POLICY batches_app_insert ON tenant.batches FOR INSERT TO aether_tenant_app
    WITH CHECK (authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.batches'));
CREATE POLICY batches_app_update ON tenant.batches FOR UPDATE TO aether_tenant_app
    USING (authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.batches'))
    WITH CHECK (authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.batches'));
CREATE POLICY batches_app_delete ON tenant.batches FOR DELETE TO aether_tenant_app
    USING (authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.batches'));

CREATE POLICY retention_policies_app_read ON tenant.retention_policies FOR SELECT TO aether_tenant_app
    USING (
        authz.current_context_allows(tenant_id, 'tenant.read', 'tenant.retention_policies')
        OR authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.retention_policies')
    );
CREATE POLICY retention_policies_app_insert ON tenant.retention_policies FOR INSERT TO aether_tenant_app
    WITH CHECK (authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.retention_policies'));
CREATE POLICY retention_policies_app_update ON tenant.retention_policies FOR UPDATE TO aether_tenant_app
    USING (authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.retention_policies'))
    WITH CHECK (authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.retention_policies'));
CREATE POLICY retention_policies_app_delete ON tenant.retention_policies FOR DELETE TO aether_tenant_app
    USING (authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.retention_policies'));

CREATE POLICY legal_holds_app_read ON tenant.legal_holds FOR SELECT TO aether_tenant_app
    USING (
        authz.current_context_allows(tenant_id, 'tenant.read', 'tenant.legal_holds')
        OR authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.legal_holds')
    );
CREATE POLICY legal_holds_app_insert ON tenant.legal_holds FOR INSERT TO aether_tenant_app
    WITH CHECK (authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.legal_holds'));
CREATE POLICY legal_holds_app_update ON tenant.legal_holds FOR UPDATE TO aether_tenant_app
    USING (authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.legal_holds'))
    WITH CHECK (authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.legal_holds'));
CREATE POLICY legal_holds_app_delete ON tenant.legal_holds FOR DELETE TO aether_tenant_app
    USING (authz.current_context_allows(tenant_id, 'tenant.write', 'tenant.legal_holds'));

CREATE POLICY placement_organizations_app_read ON tenant.placement_organizations FOR SELECT TO aether_tenant_app
    USING (
        authz.current_global_context_allows('tenant.read', 'tenant.placement_organizations')
        OR authz.current_global_context_allows('tenant.write', 'tenant.placement_organizations')
    );
CREATE POLICY placement_organizations_app_insert ON tenant.placement_organizations FOR INSERT TO aether_tenant_app
    WITH CHECK (authz.current_global_context_allows('tenant.write', 'tenant.placement_organizations'));
CREATE POLICY placement_organizations_app_update ON tenant.placement_organizations FOR UPDATE TO aether_tenant_app
    USING (authz.current_global_context_allows('tenant.write', 'tenant.placement_organizations'))
    WITH CHECK (authz.current_global_context_allows('tenant.write', 'tenant.placement_organizations'));
CREATE POLICY placement_organizations_app_delete ON tenant.placement_organizations FOR DELETE TO aether_tenant_app
    USING (authz.current_global_context_allows('tenant.write', 'tenant.placement_organizations'));

CREATE POLICY provisioning_requests_app_read ON tenant.provisioning_requests FOR SELECT TO aether_tenant_app
    USING (
        authz.current_global_context_allows('tenant.read', 'tenant.provisioning_requests')
        OR authz.current_global_context_allows('tenant.write', 'tenant.provisioning_requests')
    );
CREATE POLICY provisioning_requests_app_insert ON tenant.provisioning_requests FOR INSERT TO aether_tenant_app
    WITH CHECK (authz.current_global_context_allows('tenant.write', 'tenant.provisioning_requests'));
CREATE POLICY provisioning_requests_app_update ON tenant.provisioning_requests FOR UPDATE TO aether_tenant_app
    USING (authz.current_global_context_allows('tenant.write', 'tenant.provisioning_requests'))
    WITH CHECK (authz.current_global_context_allows('tenant.write', 'tenant.provisioning_requests'));
CREATE POLICY provisioning_requests_app_delete ON tenant.provisioning_requests FOR DELETE TO aether_tenant_app
    USING (authz.current_global_context_allows('tenant.write', 'tenant.provisioning_requests'));

CREATE POLICY tenants_owner_maintenance ON tenant.tenants FOR ALL TO aether_tenant_owner USING (true) WITH CHECK (true);
CREATE POLICY departments_owner_maintenance ON tenant.departments FOR ALL TO aether_tenant_owner USING (true) WITH CHECK (true);
CREATE POLICY batches_owner_maintenance ON tenant.batches FOR ALL TO aether_tenant_owner USING (true) WITH CHECK (true);
CREATE POLICY retention_policies_owner_maintenance ON tenant.retention_policies FOR ALL TO aether_tenant_owner USING (true) WITH CHECK (true);
CREATE POLICY legal_holds_owner_maintenance ON tenant.legal_holds FOR ALL TO aether_tenant_owner USING (true) WITH CHECK (true);
CREATE POLICY placement_organizations_owner_maintenance ON tenant.placement_organizations FOR ALL TO aether_tenant_owner USING (true) WITH CHECK (true);
CREATE POLICY provisioning_requests_owner_maintenance ON tenant.provisioning_requests FOR ALL TO aether_tenant_owner USING (true) WITH CHECK (true);

REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA tenant FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA tenant FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tenant FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON app.inbox_messages, app.command_idempotency, app.outbox_events TO aether_tenant_app;
GRANT SELECT, INSERT, UPDATE ON tenant.tenants, tenant.placement_organizations, tenant.departments,
    tenant.batches, tenant.retention_policies, tenant.legal_holds, tenant.provisioning_requests
    TO aether_tenant_app;

RESET ROLE;
