#!/usr/bin/env python3
"""Generate per-service authz SQL migration files from a shared template.

Each service hosts an identical set of authz functions that differ only in:
  - the owner role  (aether_{service}_owner)
  - the service guard in begin_authorization_projection_resync
  - the outbox event type suffix
  - the authorization table variant (global vs. tenant)

Usage (dry-run prints files to stdout):
    python3 backend/scripts/generate_authz_migration.py

Apply (write files to services/*/migrations/):
    python3 backend/scripts/generate_authz_migration.py --apply

Generate for one service only:
    python3 backend/scripts/generate_authz_migration.py --service tenant --apply

Add a new service:
    python3 backend/scripts/generate_authz_migration.py --service mynewsvc --migration-number 000007 --apply
"""

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SERVICES_ROOT = REPO_ROOT / "backend" / "services"

# question-bank uses actor_global_authorizations instead of actor_tenant_authorizations.
GLOBAL_AUTHZ_SERVICES = {"question-bank"}

# Services that receive both has_platform_authorization_at and has_tenant_authorization_at.
# question-bank only gets has_global_authorization_at.
TENANT_AUTHZ_SERVICES = {
    "analytics", "assessment", "identity", "notification",
    "seb", "submission", "tenant", "user",
}

# assessment uses a separate authorization_grants table with a different join pattern.
# All other tenant services alter actor_tenant_authorizations in migration 000004
# (rename active→is_authorized, add grant_kind column).
USES_AUTHORIZATION_GRANTS = {"assessment"}

# Map service name → migration basename as it exists (or should exist) on disk.
# Derive from the live migrations directory when --apply creates new files so
# the caller doesn't have to specify the number every time.
KNOWN_SERVICES: dict[str, str] = {
    "analytics":     "000020_fix_authz_projection_lag",
    "assessment":    "000039_fix_authz_projection_lag",
    "identity":      "000018_fix_authz_projection_lag",
    "notification":  "000017_fix_authz_projection_lag",
    "question-bank": "000029_fix_authz_projection_lag",
    "seb":           "000016_fix_authz_projection_lag",
    "submission":    "000039_fix_authz_projection_lag",
    "tenant":        "000017_fix_authz_projection_lag",
    "user":          "000046_fix_authz_projection_lag",
}


def _role(service: str) -> str:
    slug = service.replace("-", "_")
    return f"aether_{slug}_owner"


def _event_type(service: str) -> str:
    return f"authz.grants_snapshot.resync_requested.{service}.v1"


def _up_sql_tenant(service: str) -> str:
    role = _role(service)
    event = _event_type(service)
    return f"""\
SET ROLE {role};

-- Fix cascading 503 on service restart (production-grade, ADR-0078 follow-up).
-- begin_authorization_projection_resync: on warm restart (completed_at IS NOT NULL),
-- preserve projection_ready = true and keep completion fields intact. Only reset to
-- false on cold bootstrap (first ever resync, no prior completion).
-- has_platform/tenant_authorization_at: allow 5-revision lag window.

CREATE OR REPLACE FUNCTION authz.begin_authorization_projection_resync(
    p_request_event_id uuid, p_resync_id uuid, p_target_service text, p_reason text
)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, app, extensions AS $fn$
DECLARE
    event_payload jsonb;
    event_occurred_at timestamptz := clock_timestamp();
    was_ready boolean;
BEGIN
    IF p_request_event_id IS NULL OR p_resync_id IS NULL
       OR substring(p_request_event_id::text FROM 15 FOR 1) <> '7'
       OR substring(p_resync_id::text FROM 15 FOR 1) <> '7'
       OR p_target_service <> '{service}'
       OR p_reason !~ '^[a-z][a-z0-9._-]{{0,63}}$' THEN
        RAISE EXCEPTION 'invalid authorization projection resync request' USING ERRCODE = '22023';
    END IF;
    SELECT projection_ready AND (completed_at IS NOT NULL) INTO was_ready
    FROM authz.authorization_projection_resync_state WHERE singleton FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'authorization projection resync state is missing'; END IF;
    DELETE FROM authz.authorization_projection_resync_items WHERE resync_id <> p_resync_id;
    IF COALESCE(was_ready, false) THEN
        UPDATE authz.authorization_projection_resync_state
        SET active_resync_id = p_resync_id, request_event_id = p_request_event_id,
            requested_at = event_occurred_at, last_error = NULL, updated_at = event_occurred_at
        WHERE singleton;
    ELSE
        UPDATE authz.authorization_projection_resync_state
        SET active_resync_id = p_resync_id, request_event_id = p_request_event_id,
            projection_ready = false, requested_at = event_occurred_at,
            completion_event_id = NULL, expected_snapshot_count = NULL,
            expected_manifest_sha256 = NULL, completed_at = NULL,
            last_error = NULL, updated_at = event_occurred_at
        WHERE singleton;
    END IF;
    event_payload := jsonb_build_object('resync_id', p_resync_id, 'target_service', p_target_service, 'reason', p_reason);
    INSERT INTO app.outbox_events (
        event_id, aggregate_type, aggregate_id, tenant_id, event_type,
        schema_version, payload, payload_sha256, occurred_at
    ) VALUES (
        p_request_event_id, 'authz_resync', p_resync_id, NULL,
        '{event}', 1, event_payload,
        extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'), event_occurred_at
    );
    RETURN p_resync_id;
END
$fn$;

CREATE OR REPLACE FUNCTION authz.has_platform_authorization_at(
    p_actor_id uuid, p_authz_revision bigint
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $fn$
    SELECT authz.authorization_projection_ready() AND EXISTS (
        SELECT 1 FROM authz.actor_tenant_authorizations AS grant_row
        JOIN authz.principal_authorization_revisions AS revision
          ON revision.actor_id = grant_row.actor_id AND revision.authz_revision = grant_row.authz_revision
        WHERE grant_row.actor_id = p_actor_id
          AND grant_row.authz_revision >= GREATEST(1, p_authz_revision - 5)
          AND grant_row.is_authorized AND grant_row.grant_kind = 'platform'
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
    )
$fn$;

CREATE OR REPLACE FUNCTION authz.has_tenant_authorization_at(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $fn$
    SELECT authz.authorization_projection_ready() AND p_tenant_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM authz.actor_tenant_authorizations AS grant_row
        JOIN authz.principal_authorization_revisions AS revision
          ON revision.actor_id = grant_row.actor_id AND revision.authz_revision = grant_row.authz_revision
        WHERE grant_row.actor_id = p_actor_id
          AND grant_row.authz_revision >= GREATEST(1, p_authz_revision - 5)
          AND grant_row.is_authorized
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
          AND (grant_row.grant_kind = 'platform' OR grant_row.tenant_id = p_tenant_id)
    )
$fn$;
"""


def _up_sql_tenant_grants(service: str) -> str:
    """Template for services that use authorization_grants table (assessment)."""
    role = _role(service)
    event = _event_type(service)
    return f"""\
SET ROLE {role};

-- Fix cascading 503 on service restart (production-grade, ADR-0078 follow-up).
-- begin_authorization_projection_resync: on warm restart (completed_at IS NOT NULL),
-- preserve projection_ready = true and keep completion fields intact. Only reset to
-- false on cold bootstrap (first ever resync, no prior completion).
-- has_platform/tenant_authorization_at: allow 5-revision lag window.

CREATE OR REPLACE FUNCTION authz.begin_authorization_projection_resync(
    p_request_event_id uuid, p_resync_id uuid, p_target_service text, p_reason text
)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, app, extensions AS $fn$
DECLARE
    event_payload jsonb;
    event_occurred_at timestamptz := clock_timestamp();
    was_ready boolean;
BEGIN
    IF p_request_event_id IS NULL OR p_resync_id IS NULL
       OR substring(p_request_event_id::text FROM 15 FOR 1) <> '7'
       OR substring(p_resync_id::text FROM 15 FOR 1) <> '7'
       OR p_target_service <> '{service}'
       OR p_reason !~ '^[a-z][a-z0-9._-]{{0,63}}$' THEN
        RAISE EXCEPTION 'invalid authorization projection resync request' USING ERRCODE = '22023';
    END IF;
    SELECT projection_ready AND (completed_at IS NOT NULL) INTO was_ready
    FROM authz.authorization_projection_resync_state WHERE singleton FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'authorization projection resync state is missing'; END IF;
    DELETE FROM authz.authorization_projection_resync_items WHERE resync_id <> p_resync_id;
    IF COALESCE(was_ready, false) THEN
        UPDATE authz.authorization_projection_resync_state
        SET active_resync_id = p_resync_id, request_event_id = p_request_event_id,
            requested_at = event_occurred_at, last_error = NULL, updated_at = event_occurred_at
        WHERE singleton;
    ELSE
        UPDATE authz.authorization_projection_resync_state
        SET active_resync_id = p_resync_id, request_event_id = p_request_event_id,
            projection_ready = false, requested_at = event_occurred_at,
            completion_event_id = NULL, expected_snapshot_count = NULL,
            expected_manifest_sha256 = NULL, completed_at = NULL,
            last_error = NULL, updated_at = event_occurred_at
        WHERE singleton;
    END IF;
    event_payload := jsonb_build_object('resync_id', p_resync_id, 'target_service', p_target_service, 'reason', p_reason);
    INSERT INTO app.outbox_events (
        event_id, aggregate_type, aggregate_id, tenant_id, event_type,
        schema_version, payload, payload_sha256, occurred_at
    ) VALUES (
        p_request_event_id, 'authz_resync', p_resync_id, NULL,
        '{event}', 1, event_payload,
        extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'), event_occurred_at
    );
    RETURN p_resync_id;
END
$fn$;

CREATE OR REPLACE FUNCTION authz.has_platform_authorization_at(
    p_actor_id uuid, p_authz_revision bigint
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $fn$
    SELECT authz.authorization_projection_ready() AND EXISTS (
        SELECT 1 FROM authz.authorization_grants AS grant_row
        JOIN authz.principal_authorization_revisions AS revision
          ON revision.actor_id = grant_row.actor_id AND revision.authz_revision = grant_row.authz_revision
        WHERE grant_row.actor_id = p_actor_id
          AND revision.authz_revision >= GREATEST(1, p_authz_revision - 5)
          AND grant_row.grant_kind = 'platform'
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
    )
$fn$;

CREATE OR REPLACE FUNCTION authz.has_tenant_authorization_at(
    p_actor_id uuid, p_tenant_id uuid, p_authz_revision bigint
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $fn$
    SELECT authz.authorization_projection_ready() AND p_tenant_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM authz.authorization_grants AS grant_row
        JOIN authz.principal_authorization_revisions AS revision
          ON revision.actor_id = grant_row.actor_id AND revision.authz_revision = grant_row.authz_revision
        WHERE grant_row.actor_id = p_actor_id
          AND revision.authz_revision >= GREATEST(1, p_authz_revision - 5)
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp())
          AND (grant_row.grant_kind = 'platform' OR grant_row.tenant_id = p_tenant_id)
    )
$fn$;
"""


def _up_sql_global(service: str) -> str:
    role = _role(service)
    event = _event_type(service)
    return f"""\
SET ROLE {role};

-- Fix cascading 503 on service restart.
-- {service} uses actor_global_authorizations (not actor_tenant_authorizations).

CREATE OR REPLACE FUNCTION authz.begin_authorization_projection_resync(
    p_request_event_id uuid, p_resync_id uuid, p_target_service text, p_reason text
)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, app, extensions AS $function$
DECLARE
    event_payload jsonb;
    event_occurred_at timestamptz := clock_timestamp();
    was_ready boolean;
BEGIN
    IF p_request_event_id IS NULL OR p_resync_id IS NULL
       OR substring(p_request_event_id::text FROM 15 FOR 1) <> '7'
       OR substring(p_resync_id::text FROM 15 FOR 1) <> '7'
       OR p_target_service <> '{service}' OR p_reason !~ '^[a-z][a-z0-9._-]{{0,63}}$' THEN
        RAISE EXCEPTION 'invalid authorization projection resync request' USING ERRCODE = '22023';
    END IF;
    SELECT projection_ready AND (completed_at IS NOT NULL) INTO was_ready
    FROM authz.authorization_projection_resync_state WHERE singleton FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'authorization projection resync state is missing'; END IF;
    DELETE FROM authz.authorization_projection_resync_items WHERE resync_id <> p_resync_id;
    UPDATE authz.authorization_projection_resync_state
    SET active_resync_id = p_resync_id, request_event_id = p_request_event_id,
        projection_ready = COALESCE(was_ready, false),
        requested_at = event_occurred_at, completion_event_id = NULL, expected_snapshot_count = NULL,
        expected_manifest_sha256 = NULL, completed_at = NULL, last_error = NULL, updated_at = event_occurred_at
    WHERE singleton;
    event_payload := jsonb_build_object('resync_id', p_resync_id, 'target_service', p_target_service, 'reason', p_reason);
    INSERT INTO app.outbox_events (
        event_id, aggregate_type, aggregate_id, tenant_id, event_type,
        schema_version, payload, payload_sha256, occurred_at
    ) VALUES (
        p_request_event_id, 'authz_resync', p_resync_id, NULL,
        '{event}', 1, event_payload,
        extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'), event_occurred_at
    );
    RETURN p_resync_id;
END
$function$;

CREATE OR REPLACE FUNCTION authz.has_global_authorization_at(
    p_actor_id uuid, p_authz_revision bigint, p_require_write boolean
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz AS $function$
    SELECT authz.authorization_projection_ready() AND EXISTS (
        SELECT 1 FROM authz.actor_global_authorizations AS authorization_row
        WHERE authorization_row.actor_id = p_actor_id
          AND authorization_row.authz_revision >= GREATEST(1, p_authz_revision - 5)
          AND authorization_row.active
          AND (authorization_row.expires_at IS NULL OR authorization_row.expires_at > clock_timestamp())
          AND CASE WHEN p_require_write THEN authorization_row.can_write
                   ELSE authorization_row.can_read OR authorization_row.can_write END
    )
$function$;
"""


_DOWN_SQL = """\
-- Revert to exact authz_revision match (original behavior).
-- This migration's up.sql has the current function bodies.
"""


def generate(service: str, migration_base: str) -> dict[str, str]:
    """Return {relative_path: content} for .up.sql and .down.sql."""
    migrations_dir = f"backend/services/{service}/migrations"
    if service in GLOBAL_AUTHZ_SERVICES:
        up_fn = _up_sql_global
    elif service in USES_AUTHORIZATION_GRANTS:
        up_fn = _up_sql_tenant_grants
    else:
        up_fn = _up_sql_tenant
    return {
        f"{migrations_dir}/{migration_base}.up.sql": up_fn(service),
        f"{migrations_dir}/{migration_base}.down.sql": _DOWN_SQL,
    }


def _detect_migration_base(service: str) -> str | None:
    """Return the migration basename if exactly one fix_authz file exists."""
    mdir = SERVICES_ROOT / service / "migrations"
    matches = list(mdir.glob("*_fix_authz_projection_lag.up.sql"))
    if len(matches) == 1:
        return matches[0].stem  # strips .up.sql
    return None


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate or verify per-service authz projection lag migrations."
    )
    parser.add_argument(
        "--apply", action="store_true",
        help="Write files (default: dry-run, print to stdout).",
    )
    parser.add_argument(
        "--service", metavar="NAME",
        help="Restrict to one service (default: all known services).",
    )
    parser.add_argument(
        "--migration-number", metavar="NNNNNN",
        help="Six-digit migration number for a new service (e.g. 000007).",
    )
    parser.add_argument(
        "--verify", action="store_true",
        help="Check that existing files match generated content; exit 1 on diff.",
    )
    args = parser.parse_args()

    if args.service:
        # Allow ad-hoc services not yet in KNOWN_SERVICES.
        if args.service not in KNOWN_SERVICES:
            if not args.migration_number:
                parser.error(
                    f"Unknown service '{args.service}'. "
                    "Provide --migration-number for a new service."
                )
            if not re.fullmatch(r"\d{6}", args.migration_number):
                parser.error("--migration-number must be exactly 6 digits.")
            KNOWN_SERVICES[args.service] = f"{args.migration_number}_fix_authz_projection_lag"
        services = {args.service: KNOWN_SERVICES[args.service]}
    else:
        services = dict(KNOWN_SERVICES)

    diffs: list[str] = []
    written: list[str] = []
    skipped: list[str] = []

    for service, migration_base in services.items():
        files = generate(service, migration_base)
        for rel_path, content in files.items():
            abs_path = REPO_ROOT / rel_path
            if args.apply:
                abs_path.parent.mkdir(parents=True, exist_ok=True)
                if abs_path.exists() and abs_path.read_text() == content:
                    skipped.append(rel_path)
                    continue
                abs_path.write_text(content)
                written.append(rel_path)
            elif args.verify:
                if not abs_path.exists():
                    diffs.append(f"MISSING  {rel_path}")
                elif abs_path.read_text() != content:
                    diffs.append(f"DIFFERS  {rel_path}")
            else:
                print(f"-- {'='*70}")
                print(f"-- FILE: {rel_path}")
                print(f"-- {'='*70}")
                print(content)

    if args.apply:
        for p in written:
            print(f"wrote    {p}")
        for p in skipped:
            print(f"skipped  {p}  (unchanged)")

    if args.verify:
        if diffs:
            for line in diffs:
                print(line, file=sys.stderr)
            sys.exit(1)
        else:
            print(f"OK — {len(services)} service(s), all files match generated content.")


if __name__ == "__main__":
    main()
