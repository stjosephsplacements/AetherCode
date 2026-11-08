SET ROLE aether_user_owner;

-- Drop the Casbin authorization_policy_rules table now that the RBAC bitset
-- engine (ADR-0075) is the live decision path (AUTHZ_ENGINE=bitset). The
-- authorization service no longer reads this table; it uses the rbac column
-- set on each role row instead. The trigger that was bumping authz_revisions
-- on changes to this table is dropped with it.
--
-- Safety: apply only after AUTHZ_ENGINE=bitset has been live for at least 24h
-- without shadow differences. The down migration recreates the table but
-- cannot restore historical rows; a full DB backup before applying is advised.

DROP TABLE IF EXISTS users.authorization_policy_rules;
