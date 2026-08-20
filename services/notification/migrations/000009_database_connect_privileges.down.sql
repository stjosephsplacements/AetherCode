-- Keep direct reconnect grants during downgrade; PUBLIC remains denied.
SET ROLE aether_notification_owner;

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
