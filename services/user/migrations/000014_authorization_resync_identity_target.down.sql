SET ROLE aether_user_owner;

DO $block$
BEGIN
    IF EXISTS (
        SELECT 1 FROM users.authorization_resync_target_limits WHERE target_service = 'identity'
    ) OR EXISTS (
        SELECT 1 FROM users.authorization_resync_requests WHERE target_service = 'identity'
    ) THEN
        RAISE EXCEPTION 'cannot remove the identity resync target while its durable control-plane history exists';
    END IF;
END
$block$;
DELETE FROM users.authorization_resync_service_targets WHERE target_service = 'identity';
ALTER TABLE users.authorization_resync_service_targets
    DROP CONSTRAINT authorization_resync_service_targets_target_service_check;
ALTER TABLE users.authorization_resync_service_targets
    ADD CONSTRAINT authorization_resync_service_targets_target_service_check
    CHECK (target_service IN (
        'tenant', 'user', 'question-bank', 'assessment', 'submission',
        'seb', 'notification', 'analytics'
    ));

RESET ROLE;
