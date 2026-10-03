-- Identity has signed-context RLS paths and now participates in the same
-- targeted grant-resync protocol as every protected platform database.
SET ROLE aether_user_owner;

ALTER TABLE users.authorization_resync_service_targets
    DROP CONSTRAINT authorization_resync_service_targets_target_service_check;
ALTER TABLE users.authorization_resync_service_targets
    ADD CONSTRAINT authorization_resync_service_targets_target_service_check
    CHECK (target_service IN (
        'identity', 'tenant', 'user', 'question-bank', 'assessment', 'submission',
        'seb', 'notification', 'analytics'
    ));
INSERT INTO users.authorization_resync_service_targets (target_service)
VALUES ('identity') ON CONFLICT DO NOTHING;

RESET ROLE;
