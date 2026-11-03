# ADR-0067: Bronze, silver and gold analytics layers

- Status: accepted (implementation in progress)
- Date: 2026-11-03

## Context

The analytics service already has raw facts, normalised projections and rollups, but they are not named
or separated, only some events reach the raw layer, gold exists per college only, and the web app
aggregates raw exam results (limit 5000) in server components.

## Decision

Three schemas in the analytics database, `analytics_bronze`, `analytics_silver`, `analytics_gold`.

- **Bronze**: every event, append-only, monthly partitions, with lineage (`stream_seq`, `subject`,
  `schema_version`, `payload_hash`, `ingested_at`). Retention archives partitions unless a legal hold overlaps;
  a redaction job removes personal data and writes a tombstone.
- **Silver**: conformed per-college entities (today's projections) with `source_event_id`, `bronze_fact_id`,
  `pipeline_version`, `processed_at`. Handlers stay idempotent.
- **Gold**: per-college daily and summary tables, and cross-college placement tables
  (`gold_placement_student`, department and organisation summaries) readable through the placement context only.
  A dedicated writer role (insert and update, no BYPASSRLS) writes the cross-college tables.
- A `rebuild` command replays bronze in `stream_seq` order for a college and range, under an advisory lock.
- Dashboards read gold endpoints; the web app stops aggregating raw rows.

## Consequences

- One place per concern, replayable, with retention and legal holds applied at the source.
- Moving tables is metadata-only; compatibility views stay in `analytics` for one release.
