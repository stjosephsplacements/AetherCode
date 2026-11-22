-- Read-only profile-link export for the user platform-stats worker (ADR-0059 §3).
-- Role aether_notification_platform_stats_reader is created by platform bootstrap
-- (deploy/database/platform/dev-init.sh); migrations only grant.
SET ROLE aether_notification_owner;

CREATE FUNCTION notification.worker_profile_links(p_tenant_id uuid)
RETURNS TABLE (member_id uuid, platform text, handle text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, notification
AS $function$
    SELECT link.member_id, link.platform, link.handle
    FROM notification.community_profile_links AS link
    WHERE link.tenant_id = p_tenant_id
      AND btrim(link.handle) <> ''
$function$;

REVOKE ALL ON FUNCTION notification.worker_profile_links(uuid) FROM PUBLIC;

DO $grant$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aether_notification_platform_stats_reader') THEN
        GRANT EXECUTE ON FUNCTION notification.worker_profile_links(uuid) TO aether_notification_platform_stats_reader;
    END IF;
END
$grant$;

RESET ROLE;
