-- Let aether_analytics_app read gold placement rollups under existing RLS (ADR-0067).
SET ROLE aether_analytics_owner;

GRANT USAGE ON SCHEMA analytics_gold TO aether_analytics_app;
GRANT SELECT ON analytics_gold.gold_placement_student TO aether_analytics_app;

RESET ROLE;