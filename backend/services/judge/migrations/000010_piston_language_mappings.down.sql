SET ROLE aether_judge_migrator;

DO $block$
BEGIN
    IF EXISTS (SELECT 1 FROM judge.language_mappings WHERE engine_name <> 'judge0') THEN
        RAISE EXCEPTION 'Piston language mappings exist; remove them before reverting 000010';
    END IF;
END
$block$;
ALTER TABLE judge.language_mappings
    DROP CONSTRAINT language_mappings_engine_name_check,
    ADD CONSTRAINT language_mappings_engine_name_check CHECK (engine_name = 'judge0');

RESET ROLE;
