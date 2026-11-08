SET ROLE aether_analytics_owner;

CREATE OR REPLACE FUNCTION app.ensure_analytics_event_fact_partitions(
    partition_through timestamptz DEFAULT (CURRENT_TIMESTAMP + interval '2 months')
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app, analytics AS $function$
DECLARE
    partition_start timestamptz;
    partition_limit timestamptz;
    partition_end timestamptz;
    partition_name text;
BEGIN
    IF partition_through < CURRENT_TIMESTAMP - interval '8 years'
       OR partition_through > CURRENT_TIMESTAMP + interval '3 months' THEN
        RAISE EXCEPTION 'analytics partition target is outside the retained event horizon';
    END IF;
    partition_start := date_trunc('month', LEAST(CURRENT_TIMESTAMP, partition_through));
    partition_limit := date_trunc('month', GREATEST(CURRENT_TIMESTAMP + interval '2 months', partition_through));
    WHILE partition_start <= partition_limit LOOP
        partition_end := partition_start + interval '1 month';
        partition_name := format('event_facts_%s', to_char(partition_start, 'YYYYMM'));
        -- Every projected event calls this function. The CREATE statements below lock the partition (CREATE
        -- INDEX takes a SHARE lock), which blocks and deadlocks against the inserts of concurrent
        -- transactions, so touch nothing when the partition exists. Creation is serialized and re-checked.
        IF to_regclass(format('analytics.%I', partition_name)) IS NOT NULL THEN
            partition_start := partition_end;
            CONTINUE;
        END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended('analytics.event_facts.partitions', 0));
        IF to_regclass(format('analytics.%I', partition_name)) IS NOT NULL THEN
            partition_start := partition_end;
            CONTINUE;
        END IF;
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS analytics.%I PARTITION OF analytics.event_facts FOR VALUES FROM (%L) TO (%L)',
            partition_name, partition_start, partition_end
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS %I ON analytics.%I (tenant_id, event_type, occurred_at DESC)',
            format('%s_tenant_event_idx', partition_name), partition_name
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS %I ON analytics.%I (retention_until) WHERE NOT legal_hold',
            format('%s_retention_idx', partition_name), partition_name
        );
        partition_start := partition_end;
    END LOOP;
END
$function$;

RESET ROLE;
