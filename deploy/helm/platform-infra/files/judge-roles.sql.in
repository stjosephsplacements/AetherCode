DO $bootstrap$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aether_judge_migrator') THEN
        CREATE ROLE aether_judge_migrator
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aether_judge_app') THEN
        CREATE ROLE aether_judge_app
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;

    EXECUTE format('GRANT aether_judge_migrator TO %I', current_user);
    EXECUTE format('GRANT CREATE ON DATABASE %I TO aether_judge_migrator', current_database());
END
$bootstrap$;
