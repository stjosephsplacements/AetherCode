-- AtCoder and SkillRack profile links (#53). The console already knows how to link to
-- and read both; the table's CHECK only allowed five platforms, so the student profile
-- hid them. Widen the CHECK and the message that explains a refusal.
SET ROLE aether_notification_owner;

DO $drop$
DECLARE check_name text;
BEGIN
    SELECT constraint_row.conname INTO check_name
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'notification.community_profile_links'::regclass
      AND constraint_row.contype = 'c'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%leetcode%';
    IF check_name IS NULL THEN
        RAISE EXCEPTION 'the platform check on community_profile_links was not found';
    END IF;
    EXECUTE format('ALTER TABLE notification.community_profile_links DROP CONSTRAINT %I', check_name);
END
$drop$;

ALTER TABLE notification.community_profile_links
    ADD CONSTRAINT community_profile_links_platform_check
    CHECK (platform IN ('leetcode', 'github', 'codeforces', 'codechef', 'hackerrank', 'atcoder', 'skillrack'));

CREATE OR REPLACE FUNCTION notification.community_link_set(p_tenant_id uuid, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, authz, notification
AS $function$
DECLARE
    actor_id uuid := notification.community_actor(p_tenant_id, 'community', true);
    handle_value text := btrim(COALESCE(p_args ->> 'handle', ''));
BEGIN
    IF handle_value = '' THEN
        DELETE FROM notification.community_profile_links
        WHERE tenant_id = p_tenant_id AND member_id = actor_id AND platform = p_args ->> 'platform';
        RETURN jsonb_build_object('platform', p_args ->> 'platform', 'handle', NULL);
    END IF;
    INSERT INTO notification.community_profile_links (tenant_id, member_id, platform, handle)
    VALUES (p_tenant_id, actor_id, p_args ->> 'platform', handle_value)
    ON CONFLICT (tenant_id, member_id, platform) DO UPDATE SET handle = EXCLUDED.handle, updated_at = clock_timestamp();
    RETURN jsonb_build_object('platform', p_args ->> 'platform', 'handle', handle_value);
EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'choose leetcode, github, codeforces, codechef, hackerrank, atcoder or skillrack and a handle of letters, digits, dots, dashes or underscores' USING ERRCODE = '22023';
END
$function$;

RESET ROLE;
