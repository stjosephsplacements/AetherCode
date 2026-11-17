SET ROLE aether_proctor_owner;
DROP TABLE IF EXISTS proctor.processed_snapshots;
DROP TABLE IF EXISTS proctor.violations;
DROP SCHEMA IF EXISTS proctor CASCADE;
DROP EXTENSION IF EXISTS pgcrypto;
DROP SCHEMA IF EXISTS extensions CASCADE;
RESET ROLE;
