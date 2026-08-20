SET ROLE aether_question_bank_owner;

CREATE OR REPLACE FUNCTION authz.has_global_authorization_at(
    p_actor_id uuid, p_authz_revision bigint, p_require_write boolean
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
    SELECT EXISTS (
        SELECT 1 FROM authz.actor_global_authorizations AS authorization_row
        WHERE authorization_row.actor_id = p_actor_id
          AND authorization_row.authz_revision = p_authz_revision
          AND authorization_row.active
          AND (authorization_row.expires_at IS NULL OR authorization_row.expires_at > clock_timestamp())
          AND CASE WHEN p_require_write THEN authorization_row.can_write
                   ELSE authorization_row.can_read OR authorization_row.can_write END
    )
$function$;

REVOKE EXECUTE ON FUNCTION authz.begin_authorization_projection_resync(uuid, uuid, text, text)
    FROM aether_question_bank_projection_worker;
REVOKE EXECUTE ON FUNCTION authz.apply_authorization_snapshot(uuid, bigint, jsonb)
    FROM aether_question_bank_projection_worker;
REVOKE SELECT, INSERT, UPDATE, DELETE ON authz.authorization_snapshot_inbox_messages,
    authz.authorization_projection_resync_state, authz.authorization_projection_resync_items
    FROM aether_question_bank_projection_worker;
DROP FUNCTION authz.begin_authorization_projection_resync(uuid, uuid, text, text);
DROP FUNCTION authz.authorization_projection_ready();
DROP FUNCTION authz.apply_authorization_snapshot(uuid, bigint, jsonb);
DROP TABLE authz.authorization_projection_resync_items;
DROP TABLE authz.authorization_projection_resync_state;
DROP TABLE authz.authorization_snapshot_inbox_messages;

RESET ROLE;
