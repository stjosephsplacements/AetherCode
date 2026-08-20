SET ROLE aether_judge_migrator;

DROP FUNCTION IF EXISTS judge.purge_expired_execution_data(timestamptz);
DROP FUNCTION IF EXISTS judge.create_completion_deliveries_partition(date);
DROP FUNCTION IF EXISTS judge.create_execution_events_partition(date);
