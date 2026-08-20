-- Do not revoke the direct reconnect baseline on downgrade: doing so could
-- strand the non-owner migration and runtime identities after PUBLIC remains
-- revoked. The retained grants are strictly narrower than owner membership.
SET ROLE aether_identity_owner;

DO $connect$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_database AS database_row
        CROSS JOIN LATERAL aclexplode(
            COALESCE(database_row.datacl, acldefault('d', database_row.datdba))
        ) AS privilege
        WHERE database_row.datname = current_database()
          AND privilege.grantee = 0
          AND privilege.privilege_type = 'CONNECT'
    ) THEN
        RAISE EXCEPTION 'PUBLIC must not regain database CONNECT during downgrade';
    END IF;
END
$connect$;

RESET ROLE;
