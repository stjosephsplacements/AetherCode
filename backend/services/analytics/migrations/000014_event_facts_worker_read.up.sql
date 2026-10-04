SET ROLE aether_analytics_owner;

-- The projection worker appends event facts with ON CONFLICT DO NOTHING so a
-- redelivered event is harmless. Checking that conflict reads the existing
-- row, which RLS allows only through a SELECT policy, and the worker had an
-- INSERT policy alone: every append failed and analytics recorded nothing.
CREATE POLICY analytics_event_facts_projection_worker_read ON analytics.event_facts
    FOR SELECT TO aether_analytics_projection_worker USING (true);

RESET ROLE;
