SET ROLE aether_analytics_owner;

REVOKE SELECT ON analytics_gold.gold_placement_student FROM aether_analytics_app;
REVOKE USAGE ON SCHEMA analytics_gold FROM aether_analytics_app;

RESET ROLE;