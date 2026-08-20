-- Terminal wrapper records are consumed over a private mTLS pull API. Keep
-- their encrypted-reference contract enforceable at the persistence boundary
-- so a future engine worker cannot create a completion that Submission would
-- be forced to reject after it has already been leased.
SET ROLE aether_judge_migrator;

CREATE FUNCTION judge.validate_completion_outbox_payload()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, judge
AS $function$
DECLARE
    correlation_id text;
    verdict_value text;
    completed_at_value text;
    result_ref_value text;
    result_checksum_value text;
    result_key_reference_value text;
    has_result_ref boolean;
    has_result_checksum boolean;
    has_result_key_reference boolean;
BEGIN
    IF NEW.event_type NOT IN ('judge.completed.v1', 'judge.failed.v1') THEN
        RETURN NEW;
    END IF;

    IF NEW.event_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR NEW.aggregate_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR jsonb_typeof(NEW.payload) <> 'object'
    THEN
        RAISE EXCEPTION 'Judge completion identity or payload is invalid' USING ERRCODE = '22023';
    END IF;

    correlation_id := NEW.payload ->> 'submission_correlation_id';
    verdict_value := NEW.payload ->> 'verdict';
    completed_at_value := NEW.payload ->> 'completed_at';
    IF jsonb_typeof(NEW.payload -> 'submission_correlation_id') <> 'string'
       OR correlation_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR jsonb_typeof(NEW.payload -> 'verdict') <> 'string'
       OR verdict_value NOT IN (
           'accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded',
           'runtime_error', 'compile_error', 'internal_error', 'cancelled'
       )
       OR jsonb_typeof(NEW.payload -> 'completed_at') <> 'string'
       OR length(btrim(completed_at_value)) = 0
    THEN
        RAISE EXCEPTION 'Judge completion identity, verdict, or completion time is invalid' USING ERRCODE = '22023';
    END IF;
    BEGIN
        PERFORM completed_at_value::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
        RAISE EXCEPTION 'Judge completion time is invalid' USING ERRCODE = '22023';
    END;

    IF (NEW.payload ? 'result_ref' AND jsonb_typeof(NEW.payload -> 'result_ref') NOT IN ('string', 'null'))
       OR (NEW.payload ? 'result_sha256' AND jsonb_typeof(NEW.payload -> 'result_sha256') NOT IN ('string', 'null'))
       OR (NEW.payload ? 'result_encryption_key_reference' AND jsonb_typeof(NEW.payload -> 'result_encryption_key_reference') NOT IN ('string', 'null'))
    THEN
        RAISE EXCEPTION 'Judge encrypted result fields must be strings or null' USING ERRCODE = '22023';
    END IF;

    result_ref_value := btrim(COALESCE(NEW.payload ->> 'result_ref', ''));
    result_checksum_value := btrim(COALESCE(NEW.payload ->> 'result_sha256', ''));
    result_key_reference_value := btrim(COALESCE(NEW.payload ->> 'result_encryption_key_reference', ''));
    has_result_ref := result_ref_value <> '';
    has_result_checksum := result_checksum_value <> '';
    has_result_key_reference := result_key_reference_value <> '';
    IF has_result_ref <> has_result_checksum OR has_result_ref <> has_result_key_reference THEN
        RAISE EXCEPTION 'Judge encrypted result reference, checksum, and key reference must be all-or-none' USING ERRCODE = '22023';
    END IF;
    IF has_result_ref AND (
        length(result_ref_value) > 2048
        OR result_checksum_value !~ '^[0-9a-f]{64}$'
        OR length(result_key_reference_value) > 1024
    ) THEN
        RAISE EXCEPTION 'Judge encrypted result reference is invalid' USING ERRCODE = '22023';
    END IF;

    IF NEW.payload ? 'execution_time_ms'
       AND NEW.payload -> 'execution_time_ms' <> 'null'::jsonb
       AND (
           jsonb_typeof(NEW.payload -> 'execution_time_ms') <> 'number'
           OR NEW.payload ->> 'execution_time_ms' !~ '^(0|[1-9][0-9]*)$'
           OR (NEW.payload ->> 'execution_time_ms')::numeric > 2147483647
       )
    THEN
        RAISE EXCEPTION 'Judge execution_time_ms is invalid' USING ERRCODE = '22023';
    END IF;
    IF NEW.payload ? 'memory_kib'
       AND NEW.payload -> 'memory_kib' <> 'null'::jsonb
       AND (
           jsonb_typeof(NEW.payload -> 'memory_kib') <> 'number'
           OR NEW.payload ->> 'memory_kib' !~ '^(0|[1-9][0-9]*)$'
           OR (NEW.payload ->> 'memory_kib')::numeric > 2147483647
       )
    THEN
        RAISE EXCEPTION 'Judge memory_kib is invalid' USING ERRCODE = '22023';
    END IF;

    RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION judge.validate_completion_outbox_payload() FROM PUBLIC;

CREATE TRIGGER outbox_events_completion_contract
BEFORE INSERT OR UPDATE OF event_type, payload ON judge.outbox_events
FOR EACH ROW EXECUTE FUNCTION judge.validate_completion_outbox_payload();

RESET ROLE;
