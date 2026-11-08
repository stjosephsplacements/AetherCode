SET ROLE aether_user_owner;

-- Recreate the Casbin authorization_policy_rules table. Historical policy rows
-- are NOT restored; this only restores the schema to allow re-migration.
-- To restore data, apply from a backup taken before the up migration.

CREATE TABLE IF NOT EXISTS users.authorization_policy_rules (
    id         uuid        NOT NULL DEFAULT gen_random_uuid(),
    ptype      text        NOT NULL CONSTRAINT "authorization_policy_rules_ptype_check" CHECK (ptype ~ '^[a-z][a-z0-9_]{0,31}$'),
    v0         text,
    v1         text,
    v2         text,
    v3         text,
    v4         text,
    v5         text,
    status     text        NOT NULL DEFAULT 'active' CONSTRAINT "authorization_policy_rules_status_check" CHECK (status = ANY (ARRAY['active'::text, 'revoked'::text])),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    revoked_at timestamptz,
    CONSTRAINT "authorization_policy_rules_pkey" PRIMARY KEY (id),
    CONSTRAINT "authorization_policy_rules_check" CHECK ((status = 'active') = (revoked_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS "authorization_policy_rules_active_unique"
    ON users.authorization_policy_rules (ptype, COALESCE(v0,''), COALESCE(v1,''), COALESCE(v2,''), COALESCE(v3,''), COALESCE(v4,''), COALESCE(v5,''))
    WHERE status = 'active';
