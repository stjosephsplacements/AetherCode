SET ROLE aether_question_bank_owner;

-- The bootstrap outbox predated the shared durable publisher. Rename the
-- unshipped columns into its exact lease contract and retain every pending
-- event for at-least-once replay.
DROP INDEX IF EXISTS app.outbox_events_ready_idx;

ALTER TABLE app.outbox_events RENAME COLUMN id TO event_id;
ALTER TABLE app.outbox_events RENAME COLUMN available_at TO next_attempt_at;
ALTER TABLE app.outbox_events RENAME COLUMN publish_attempts TO publication_attempts;
ALTER TABLE app.outbox_events RENAME COLUMN locked_at TO locked_until;

DO $constraints$
DECLARE
    constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT constraint_item.conname
        FROM pg_constraint AS constraint_item
        WHERE constraint_item.conrelid = 'app.outbox_events'::regclass
          AND constraint_item.contype = 'c'
          AND pg_get_constraintdef(constraint_item.oid) LIKE '%lock_token%'
    LOOP
        EXECUTE format('ALTER TABLE app.outbox_events DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END
$constraints$;

-- A legacy lock held an acquisition time plus opaque token. Releasing it is
-- the safe conversion: a publisher crash can only cause a duplicate event,
-- never strand work.
UPDATE app.outbox_events
SET locked_until = NULL
WHERE locked_until IS NOT NULL;

ALTER TABLE app.outbox_events DROP COLUMN lock_token;
ALTER TABLE app.outbox_events ADD COLUMN payload_sha256 bytea;
UPDATE app.outbox_events
SET payload_sha256 = extensions.digest(convert_to(payload::text, 'UTF8'), 'sha256')
WHERE payload_sha256 IS NULL;
ALTER TABLE app.outbox_events ALTER COLUMN payload_sha256 SET NOT NULL;
ALTER TABLE app.outbox_events
    ADD CONSTRAINT outbox_events_payload_sha256_check
    CHECK (octet_length(payload_sha256) = 32);

CREATE INDEX outbox_events_ready_idx
    ON app.outbox_events (next_attempt_at, occurred_at)
    WHERE published_at IS NULL;

-- Every mutable draft carries its own optimistic revision. Question-level
-- revisions protect aggregate transitions, while this one protects concurrent
-- edits to manifests, assets, and tags before publication.
ALTER TABLE qbank.question_versions
    ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE qbank.question_versions
    ADD CONSTRAINT question_versions_supported_languages_nonempty
    CHECK (jsonb_array_length(supported_languages) > 0);

CREATE FUNCTION qbank.require_write_context(p_resource text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, app
AS $function$
DECLARE
    actor_id uuid;
BEGIN
    SELECT context.actor_id
    INTO actor_id
    FROM authz.request_contexts AS context
    JOIN authz.actor_global_authorizations AS authorization_row
      ON authorization_row.actor_id = context.actor_id
     AND authorization_row.authz_revision = context.authz_revision
    WHERE context.context_id = app.current_context_id()
      AND context.backend_pid = pg_backend_pid()
      AND context.transaction_id = txid_current()
      AND context.tenant_id IS NULL
      AND context.action = 'qbank.write'
      AND context.resource = p_resource
      AND context.expires_at > clock_timestamp()
      AND authorization_row.active
      AND authorization_row.can_write
      AND (authorization_row.expires_at IS NULL OR authorization_row.expires_at > clock_timestamp())
    FOR SHARE OF authorization_row;

    IF actor_id IS NULL THEN
        RAISE EXCEPTION 'current authorization context cannot write %', p_resource
            USING ERRCODE = '42501';
    END IF;
    RETURN actor_id;
END
$function$;

CREATE FUNCTION qbank.require_read_context(p_resource text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz
AS $function$
BEGIN
    IF p_resource IS NULL THEN
        RAISE EXCEPTION 'current authorization context cannot read %', p_resource
            USING ERRCODE = '42501';
    END IF;

    PERFORM context.actor_id
    FROM authz.request_contexts AS context
    JOIN authz.actor_global_authorizations AS authorization_row
      ON authorization_row.actor_id = context.actor_id
     AND authorization_row.authz_revision = context.authz_revision
    WHERE context.context_id = app.current_context_id()
      AND context.backend_pid = pg_backend_pid()
      AND context.transaction_id = txid_current()
      AND context.tenant_id IS NULL
      AND context.action IN ('qbank.read', 'qbank.write')
      AND context.resource = p_resource
      AND context.expires_at > clock_timestamp()
      AND authorization_row.active
      AND (authorization_row.can_read OR authorization_row.can_write)
      AND (authorization_row.expires_at IS NULL OR authorization_row.expires_at > clock_timestamp())
    FOR SHARE OF authorization_row;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'current authorization context cannot read %', p_resource
            USING ERRCODE = '42501';
    END IF;
END
$function$;

CREATE FUNCTION qbank.apply_version_tags(p_question_version_id uuid, p_tags jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
DECLARE
    tag_item jsonb;
    supplied_tag_id uuid;
    persisted_tag_id uuid;
    tag_name text;
BEGIN
    IF p_question_version_id IS NULL OR jsonb_typeof(p_tags) <> 'array' THEN
        RAISE EXCEPTION 'question version and tags array are required' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_tags) > 50 THEN
        RAISE EXCEPTION 'a question version may have at most 50 tags' USING ERRCODE = '22023';
    END IF;

    DELETE FROM qbank.question_version_tags
    WHERE question_version_id = p_question_version_id;

    FOR tag_item IN SELECT value FROM jsonb_array_elements(p_tags) LOOP
        IF jsonb_typeof(tag_item) <> 'object' THEN
            RAISE EXCEPTION 'tag must be an object' USING ERRCODE = '22023';
        END IF;
        BEGIN
            supplied_tag_id := (tag_item ->> 'id')::uuid;
        EXCEPTION WHEN invalid_text_representation THEN
            RAISE EXCEPTION 'tag identifier is invalid' USING ERRCODE = '22023';
        END;
        tag_name := btrim(tag_item ->> 'name');
        IF supplied_tag_id IS NULL
           OR tag_name IS NULL
           OR char_length(tag_name) NOT BETWEEN 1 AND 80
           OR tag_name <> lower(tag_name)
           OR tag_name ~ '[[:cntrl:]]' THEN
            RAISE EXCEPTION 'tag is invalid' USING ERRCODE = '22023';
        END IF;

        INSERT INTO qbank.tags (id, name, normalized_name)
        VALUES (supplied_tag_id, tag_name, tag_name)
        ON CONFLICT (normalized_name) DO UPDATE
        SET name = qbank.tags.name
        RETURNING id INTO persisted_tag_id;

        INSERT INTO qbank.question_version_tags (question_version_id, tag_id)
        VALUES (p_question_version_id, persisted_tag_id)
        ON CONFLICT DO NOTHING;
    END LOOP;
END
$function$;

CREATE FUNCTION qbank.question_version_summary(p_question_version_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
    SELECT jsonb_build_object(
        'id', question_version.id,
        'question_id', question_version.question_id,
        'version_number', question_version.version_number,
        'title', question_version.title,
        'prompt_markdown', question_version.prompt_markdown,
        'difficulty', question_version.difficulty,
        'supported_languages', question_version.supported_languages,
        'time_limit_ms', question_version.time_limit_ms,
        'memory_limit_kib', question_version.memory_limit_kib,
        'status', question_version.status,
        'published_at', question_version.published_at,
        'created_at', question_version.created_at,
        'version', question_version.version,
        'tags', COALESCE(tags.items, '[]'::jsonb),
        'sample_test_case_count', COALESCE(manifests.sample_test_case_count, 0),
        'hidden_test_case_count', COALESCE(manifests.hidden_test_case_count, 0),
        'asset_count', COALESCE(assets.asset_count, 0)
    )
    FROM qbank.question_versions AS question_version
    LEFT JOIN LATERAL (
        SELECT jsonb_agg(
            jsonb_build_object('id', tag.id, 'name', tag.name)
            ORDER BY tag.normalized_name
        ) AS items
        FROM qbank.question_version_tags AS question_version_tag
        JOIN qbank.tags AS tag ON tag.id = question_version_tag.tag_id
        WHERE question_version_tag.question_version_id = question_version.id
    ) AS tags ON true
    LEFT JOIN LATERAL (
        SELECT
            COALESCE(sum(test_manifest.test_case_count) FILTER (WHERE test_manifest.manifest_kind = 'sample'), 0)::integer
                AS sample_test_case_count,
            COALESCE(sum(test_manifest.test_case_count) FILTER (WHERE test_manifest.manifest_kind = 'hidden'), 0)::integer
                AS hidden_test_case_count
        FROM qbank.test_case_manifests AS test_manifest
        WHERE test_manifest.question_version_id = question_version.id
    ) AS manifests ON true
    LEFT JOIN LATERAL (
        SELECT count(*)::integer AS asset_count
        FROM qbank.question_assets AS asset
        WHERE asset.question_version_id = question_version.id
    ) AS assets ON true
    WHERE question_version.id = p_question_version_id
$function$;

CREATE FUNCTION qbank.question_response(p_question_id uuid, p_question_version_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
    SELECT jsonb_build_object(
        'question', jsonb_build_object(
            'id', question.id,
            'slug', question.slug,
            'lifecycle_state', question.lifecycle_state,
            'created_at', question.created_at,
            'archived_at', question.archived_at,
            'version', question.version
        ),
        'question_version', qbank.question_version_summary(p_question_version_id)
    )
    FROM qbank.questions AS question
    WHERE question.id = p_question_id
$function$;

CREATE FUNCTION qbank.enqueue_question_event(
    p_event_id uuid,
    p_aggregate_type text,
    p_aggregate_id uuid,
    p_event_type text,
    p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, extensions
AS $function$
BEGIN
    IF p_event_id IS NULL
       OR p_aggregate_id IS NULL
       OR p_aggregate_type IS NULL
       OR p_event_type IS NULL
       OR jsonb_typeof(p_payload) <> 'object' THEN
        RAISE EXCEPTION 'question event is invalid' USING ERRCODE = '22023';
    END IF;
    INSERT INTO app.outbox_events (
        event_id, aggregate_type, aggregate_id, tenant_id, event_type,
        schema_version, payload, payload_sha256, occurred_at
    ) VALUES (
        p_event_id, p_aggregate_type, p_aggregate_id, NULL, p_event_type,
        1, p_payload, extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), clock_timestamp()
    );
END
$function$;

CREATE FUNCTION qbank.require_publish_ready()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, qbank
AS $function$
BEGIN
    IF NEW.status = 'published'
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
        IF NEW.published_at IS NULL
           OR jsonb_array_length(NEW.supported_languages) < 1
           OR NOT EXISTS (
               SELECT 1 FROM qbank.test_case_manifests AS manifest
               WHERE manifest.question_version_id = NEW.id
                 AND manifest.manifest_kind = 'sample'
           )
           OR NOT EXISTS (
               SELECT 1 FROM qbank.test_case_manifests AS manifest
               WHERE manifest.question_version_id = NEW.id
                 AND manifest.manifest_kind = 'hidden'
           )
           OR EXISTS (
               SELECT 1 FROM qbank.questions AS question
               WHERE question.id = NEW.question_id
                 AND question.lifecycle_state = 'archived'
           ) THEN
            RAISE EXCEPTION 'published question versions require sample and hidden manifests, languages, and an active question'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END
$function$;

CREATE TRIGGER question_versions_require_publish_ready
    BEFORE INSERT OR UPDATE OF status, published_at ON qbank.question_versions
    FOR EACH ROW EXECUTE FUNCTION qbank.require_publish_ready();

CREATE FUNCTION qbank.create_question(
    p_question_id uuid,
    p_question_version_id uuid,
    p_event_id uuid,
    p_slug text,
    p_title text,
    p_prompt_markdown text,
    p_difficulty text,
    p_supported_languages jsonb,
    p_time_limit_ms integer,
    p_memory_limit_kib integer,
    p_evaluation_bundle_object_key text,
    p_evaluation_bundle_checksum text,
    p_encryption_key_reference text,
    p_tags jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    actor_id uuid;
    response jsonb;
BEGIN
    actor_id := qbank.require_write_context('qbank.questions');
    IF p_question_id IS NULL
       OR p_question_version_id IS NULL
       OR p_event_id IS NULL
       OR jsonb_typeof(p_supported_languages) <> 'array'
       OR jsonb_typeof(p_tags) <> 'array' THEN
        RAISE EXCEPTION 'question creation inputs are invalid' USING ERRCODE = '22023';
    END IF;

    INSERT INTO qbank.questions (id, slug, lifecycle_state, created_by)
    VALUES (p_question_id, p_slug, 'draft', actor_id);
    INSERT INTO qbank.question_versions (
        id, question_id, version_number, title, prompt_markdown, difficulty,
        supported_languages, time_limit_ms, memory_limit_kib,
        evaluation_bundle_object_key, evaluation_bundle_checksum,
        encryption_key_reference, status, created_by
    ) VALUES (
        p_question_version_id, p_question_id, 1, p_title, p_prompt_markdown, p_difficulty,
        p_supported_languages, p_time_limit_ms, p_memory_limit_kib,
        p_evaluation_bundle_object_key, p_evaluation_bundle_checksum,
        p_encryption_key_reference, 'draft', actor_id
    );
    PERFORM qbank.apply_version_tags(p_question_version_id, p_tags);
    PERFORM qbank.enqueue_question_event(
        p_event_id, 'question', p_question_id, 'qbank.question.created.v1',
        jsonb_build_object(
            'question_id', p_question_id,
            'question_version_id', p_question_version_id,
            'slug', p_slug,
            'version_number', 1
        )
    );
    SELECT qbank.question_response(p_question_id, p_question_version_id) INTO response;
    RETURN response;
END
$function$;

CREATE FUNCTION qbank.create_draft_question_version(
    p_question_version_id uuid,
    p_event_id uuid,
    p_question_id uuid,
    p_expected_question_revision bigint,
    p_title text,
    p_prompt_markdown text,
    p_difficulty text,
    p_supported_languages jsonb,
    p_time_limit_ms integer,
    p_memory_limit_kib integer,
    p_evaluation_bundle_object_key text,
    p_evaluation_bundle_checksum text,
    p_encryption_key_reference text,
    p_tags jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    actor_id uuid;
    question_row qbank.questions%ROWTYPE;
    next_version_number integer;
    response jsonb;
BEGIN
    actor_id := qbank.require_write_context('qbank.question_versions');
    IF p_question_version_id IS NULL
       OR p_event_id IS NULL
       OR p_question_id IS NULL
       OR p_expected_question_revision <= 0
       OR jsonb_typeof(p_supported_languages) <> 'array'
       OR jsonb_typeof(p_tags) <> 'array' THEN
        RAISE EXCEPTION 'question version creation inputs are invalid' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO question_row
    FROM qbank.questions
    WHERE id = p_question_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'question was not found' USING ERRCODE = 'P0002';
    END IF;
    IF question_row.lifecycle_state = 'archived' THEN
        RAISE EXCEPTION 'archived questions cannot receive new versions' USING ERRCODE = '55000';
    END IF;
    IF question_row.version <> p_expected_question_revision THEN
        RAISE EXCEPTION 'question revision is stale' USING ERRCODE = '40001';
    END IF;

    SELECT COALESCE(max(version_number), 0) + 1
    INTO next_version_number
    FROM qbank.question_versions
    WHERE question_id = p_question_id;

    INSERT INTO qbank.question_versions (
        id, question_id, version_number, title, prompt_markdown, difficulty,
        supported_languages, time_limit_ms, memory_limit_kib,
        evaluation_bundle_object_key, evaluation_bundle_checksum,
        encryption_key_reference, status, created_by
    ) VALUES (
        p_question_version_id, p_question_id, next_version_number, p_title, p_prompt_markdown, p_difficulty,
        p_supported_languages, p_time_limit_ms, p_memory_limit_kib,
        p_evaluation_bundle_object_key, p_evaluation_bundle_checksum,
        p_encryption_key_reference, 'draft', actor_id
    );
    PERFORM qbank.apply_version_tags(p_question_version_id, p_tags);
    UPDATE qbank.questions
    SET version = version + 1
    WHERE id = p_question_id;
    PERFORM qbank.enqueue_question_event(
        p_event_id, 'question_version', p_question_version_id, 'qbank.question.version_created.v1',
        jsonb_build_object(
            'question_id', p_question_id,
            'question_version_id', p_question_version_id,
            'version_number', next_version_number
        )
    );
    SELECT qbank.question_response(p_question_id, p_question_version_id) INTO response;
    RETURN response;
END
$function$;

CREATE FUNCTION qbank.upsert_test_case_manifest(
    p_manifest_id uuid,
    p_question_version_id uuid,
    p_manifest_kind text,
    p_object_key text,
    p_checksum text,
    p_encryption_key_reference text,
    p_test_case_count integer,
    p_expected_question_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    actor_id uuid;
    version_row qbank.question_versions%ROWTYPE;
    response jsonb;
BEGIN
    actor_id := qbank.require_write_context('qbank.test_case_manifests');
    IF p_manifest_id IS NULL
       OR p_question_version_id IS NULL
       OR p_manifest_kind NOT IN ('sample', 'hidden')
       OR p_test_case_count IS NULL
       OR p_expected_question_version <= 0 THEN
        RAISE EXCEPTION 'test manifest inputs are invalid' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO version_row
    FROM qbank.question_versions
    WHERE id = p_question_version_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'question version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'published question versions cannot change manifests' USING ERRCODE = '55000';
    END IF;
    IF version_row.version <> p_expected_question_version THEN
        RAISE EXCEPTION 'question version revision is stale' USING ERRCODE = '40001';
    END IF;

    IF p_manifest_kind = 'hidden' THEN
        INSERT INTO qbank.test_case_manifests (
            id, question_version_id, manifest_kind, object_key, checksum,
            encryption_key_reference, test_case_count, created_by
        ) VALUES (
            p_manifest_id, p_question_version_id, p_manifest_kind, p_object_key, p_checksum,
            p_encryption_key_reference, p_test_case_count, actor_id
        );
    ELSE
        INSERT INTO qbank.test_case_manifests (
            id, question_version_id, manifest_kind, object_key, checksum,
            encryption_key_reference, test_case_count, created_by
        ) VALUES (
            p_manifest_id, p_question_version_id, p_manifest_kind, p_object_key, p_checksum,
            p_encryption_key_reference, p_test_case_count, actor_id
        ) ON CONFLICT (question_version_id, manifest_kind) DO UPDATE
        SET object_key = EXCLUDED.object_key,
            checksum = EXCLUDED.checksum,
            encryption_key_reference = EXCLUDED.encryption_key_reference,
            test_case_count = EXCLUDED.test_case_count;
    END IF;
    UPDATE qbank.question_versions
    SET version = version + 1
    WHERE id = p_question_version_id;
    SELECT qbank.question_version_summary(p_question_version_id) INTO response;
    RETURN response;
END
$function$;

CREATE FUNCTION qbank.add_question_asset(
    p_asset_id uuid,
    p_question_version_id uuid,
    p_asset_kind text,
    p_object_key text,
    p_checksum text,
    p_encryption_key_reference text,
    p_content_type text,
    p_byte_size bigint,
    p_expected_question_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    version_row qbank.question_versions%ROWTYPE;
    response jsonb;
BEGIN
    PERFORM qbank.require_write_context('qbank.question_assets');
    IF p_asset_id IS NULL
       OR p_question_version_id IS NULL
       OR p_asset_kind NOT IN ('attachment', 'starter_code', 'reference_solution')
       OR p_byte_size IS NULL
       OR p_expected_question_version <= 0 THEN
        RAISE EXCEPTION 'question asset inputs are invalid' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO version_row
    FROM qbank.question_versions
    WHERE id = p_question_version_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'question version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'published question versions cannot change assets' USING ERRCODE = '55000';
    END IF;
    IF version_row.version <> p_expected_question_version THEN
        RAISE EXCEPTION 'question version revision is stale' USING ERRCODE = '40001';
    END IF;

    INSERT INTO qbank.question_assets (
        id, question_version_id, asset_kind, object_key, checksum,
        encryption_key_reference, content_type, byte_size
    ) VALUES (
        p_asset_id, p_question_version_id, p_asset_kind, p_object_key, p_checksum,
        p_encryption_key_reference, p_content_type, p_byte_size
    );
    UPDATE qbank.question_versions
    SET version = version + 1
    WHERE id = p_question_version_id;
    SELECT qbank.question_version_summary(p_question_version_id) INTO response;
    RETURN response;
END
$function$;

CREATE FUNCTION qbank.replace_question_version_tags(
    p_question_version_id uuid,
    p_expected_question_version bigint,
    p_tags jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    version_row qbank.question_versions%ROWTYPE;
    response jsonb;
BEGIN
    PERFORM qbank.require_write_context('qbank.question_version_tags');
    IF p_question_version_id IS NULL
       OR p_expected_question_version <= 0
       OR jsonb_typeof(p_tags) <> 'array' THEN
        RAISE EXCEPTION 'question version tag inputs are invalid' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO version_row
    FROM qbank.question_versions
    WHERE id = p_question_version_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'question version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'published question versions cannot change tags' USING ERRCODE = '55000';
    END IF;
    IF version_row.version <> p_expected_question_version THEN
        RAISE EXCEPTION 'question version revision is stale' USING ERRCODE = '40001';
    END IF;

    PERFORM qbank.apply_version_tags(p_question_version_id, p_tags);
    UPDATE qbank.question_versions
    SET version = version + 1
    WHERE id = p_question_version_id;
    SELECT qbank.question_version_summary(p_question_version_id) INTO response;
    RETURN response;
END
$function$;

CREATE FUNCTION qbank.publish_question_version(
    p_question_version_id uuid,
    p_event_id uuid,
    p_expected_question_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    version_row qbank.question_versions%ROWTYPE;
    question_row qbank.questions%ROWTYPE;
    published_at_value timestamptz;
    response jsonb;
BEGIN
    PERFORM qbank.require_write_context('qbank.question_versions');
    IF p_question_version_id IS NULL OR p_event_id IS NULL OR p_expected_question_version <= 0 THEN
        RAISE EXCEPTION 'question version publication inputs are invalid' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO version_row
    FROM qbank.question_versions
    WHERE id = p_question_version_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'question version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'only draft question versions may be published' USING ERRCODE = '55000';
    END IF;
    IF version_row.version <> p_expected_question_version THEN
        RAISE EXCEPTION 'question version revision is stale' USING ERRCODE = '40001';
    END IF;
    SELECT * INTO question_row
    FROM qbank.questions
    WHERE id = version_row.question_id
    FOR UPDATE;
    IF question_row.lifecycle_state = 'archived' THEN
        RAISE EXCEPTION 'archived questions cannot be published' USING ERRCODE = '55000';
    END IF;

    UPDATE qbank.question_versions
    SET status = 'published', published_at = clock_timestamp(), version = version + 1
    WHERE id = p_question_version_id
    RETURNING published_at INTO published_at_value;
    UPDATE qbank.questions
    SET lifecycle_state = 'published', version = version + 1
    WHERE id = question_row.id;
    PERFORM qbank.enqueue_question_event(
        p_event_id, 'question_version', p_question_version_id, 'qbank.question.version_published.v1',
        jsonb_build_object(
            'question_id', question_row.id,
            'question_version_id', p_question_version_id,
            'version_number', version_row.version_number,
            'published_at', published_at_value
        )
    );
    SELECT qbank.question_response(question_row.id, p_question_version_id) INTO response;
    RETURN response;
END
$function$;

CREATE FUNCTION qbank.archive_question(
    p_question_id uuid,
    p_event_id uuid,
    p_expected_question_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank, authz, app
AS $function$
DECLARE
    question_row qbank.questions%ROWTYPE;
    latest_version_id uuid;
    response jsonb;
BEGIN
    PERFORM qbank.require_write_context('qbank.questions');
    IF p_question_id IS NULL OR p_event_id IS NULL OR p_expected_question_revision <= 0 THEN
        RAISE EXCEPTION 'question archive inputs are invalid' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO question_row
    FROM qbank.questions
    WHERE id = p_question_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'question was not found' USING ERRCODE = 'P0002';
    END IF;
    IF question_row.lifecycle_state = 'archived' THEN
        RAISE EXCEPTION 'question is already archived' USING ERRCODE = '55000';
    END IF;
    IF question_row.version <> p_expected_question_revision THEN
        RAISE EXCEPTION 'question revision is stale' USING ERRCODE = '40001';
    END IF;

    UPDATE qbank.questions
    SET lifecycle_state = 'archived', archived_at = clock_timestamp(), version = version + 1
    WHERE id = p_question_id;
    SELECT id INTO latest_version_id
    FROM qbank.question_versions
    WHERE question_id = p_question_id
    ORDER BY version_number DESC
    LIMIT 1;
    PERFORM qbank.enqueue_question_event(
        p_event_id, 'question', p_question_id, 'qbank.question.archived.v1',
        jsonb_build_object('question_id', p_question_id)
    );
    SELECT qbank.question_response(p_question_id, latest_version_id) INTO response;
    RETURN response;
END
$function$;

CREATE FUNCTION qbank.get_published_question(p_question_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
DECLARE
    published_version_id uuid;
    response jsonb;
BEGIN
    PERFORM qbank.require_read_context('qbank.questions');
    SELECT question_version.id INTO published_version_id
    FROM qbank.questions AS question
    JOIN qbank.question_versions AS question_version ON question_version.question_id = question.id
    WHERE question.id = p_question_id
      AND question.lifecycle_state <> 'archived'
      AND question_version.status = 'published'
    ORDER BY question_version.version_number DESC
    LIMIT 1;
    IF published_version_id IS NULL THEN
        RAISE EXCEPTION 'published question was not found' USING ERRCODE = 'P0002';
    END IF;
    SELECT qbank.question_response(p_question_id, published_version_id) INTO response;
    RETURN response;
END
$function$;

CREATE FUNCTION qbank.get_question_version(p_question_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
DECLARE
    response jsonb;
BEGIN
    PERFORM qbank.require_read_context('qbank.question_versions');
    SELECT qbank.question_version_summary(p_question_version_id) INTO response;
    IF response IS NULL THEN
        RAISE EXCEPTION 'question version was not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN response;
END
$function$;

CREATE FUNCTION qbank.list_published_questions(p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
DECLARE
    response jsonb;
BEGIN
    PERFORM qbank.require_read_context('qbank.questions');
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
        RAISE EXCEPTION 'question listing limit must be between 1 and 100' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(jsonb_agg(qbank.question_response(item.question_id, item.question_version_id)
                              ORDER BY item.published_at DESC, item.question_version_id DESC), '[]'::jsonb)
    INTO response
    FROM (
        SELECT question.id AS question_id, question_version.id AS question_version_id, question_version.published_at
        FROM qbank.questions AS question
        JOIN LATERAL (
            SELECT version_item.id, version_item.published_at
            FROM qbank.question_versions AS version_item
            WHERE version_item.question_id = question.id
              AND version_item.status = 'published'
            ORDER BY version_item.version_number DESC
            LIMIT 1
        ) AS question_version ON true
        WHERE question.lifecycle_state <> 'archived'
        ORDER BY question_version.published_at DESC, question_version.id DESC
        LIMIT p_limit
    ) AS item;
    RETURN response;
END
$function$;

-- Aggregate functions are the only application mutation/read surface. They
-- bind one signed resource capability to all internal relations, keeping RLS
-- exact while retaining atomic question creation and publication.
REVOKE ALL ON TABLE
    qbank.questions,
    qbank.question_versions,
    qbank.test_case_manifests,
    qbank.question_assets,
    qbank.tags,
    qbank.question_version_tags
FROM aether_question_bank_app;

REVOKE ALL ON FUNCTION
    qbank.require_write_context(text),
    qbank.require_read_context(text),
    qbank.apply_version_tags(uuid, jsonb),
    qbank.question_version_summary(uuid),
    qbank.question_response(uuid, uuid),
    qbank.enqueue_question_event(uuid, text, uuid, text, jsonb),
    qbank.require_publish_ready(),
    qbank.create_question(uuid, uuid, uuid, text, text, text, text, jsonb, integer, integer, text, text, text, jsonb),
    qbank.create_draft_question_version(uuid, uuid, uuid, bigint, text, text, text, jsonb, integer, integer, text, text, text, jsonb),
    qbank.upsert_test_case_manifest(uuid, uuid, text, text, text, text, integer, bigint),
    qbank.add_question_asset(uuid, uuid, text, text, text, text, text, bigint, bigint),
    qbank.replace_question_version_tags(uuid, bigint, jsonb),
    qbank.publish_question_version(uuid, uuid, bigint),
    qbank.archive_question(uuid, uuid, bigint),
    qbank.get_published_question(uuid),
    qbank.get_question_version(uuid),
    qbank.list_published_questions(integer)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
    qbank.create_question(uuid, uuid, uuid, text, text, text, text, jsonb, integer, integer, text, text, text, jsonb),
    qbank.create_draft_question_version(uuid, uuid, uuid, bigint, text, text, text, jsonb, integer, integer, text, text, text, jsonb),
    qbank.upsert_test_case_manifest(uuid, uuid, text, text, text, text, integer, bigint),
    qbank.add_question_asset(uuid, uuid, text, text, text, text, text, bigint, bigint),
    qbank.replace_question_version_tags(uuid, bigint, jsonb),
    qbank.publish_question_version(uuid, uuid, bigint),
    qbank.archive_question(uuid, uuid, bigint),
    qbank.get_published_question(uuid),
    qbank.get_question_version(uuid),
    qbank.list_published_questions(integer)
TO aether_question_bank_app;

RESET ROLE;
