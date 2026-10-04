SET ROLE aether_analytics_owner;

DROP POLICY analytics_event_facts_projection_worker_read ON analytics.event_facts;

RESET ROLE;
