# ADR-0064: Generated SEB Config Key

- Status: accepted
- Date: 2026-11-02

## Context

Staff had to open the exam's launch file in SEB's config tool and paste the Browser Exam Key or
Config Key into the lockdown form. The exam app (`apps/exam-v1/lib/seb.ts`) instead computes the
Config Key from the config it generates.

## Decision

The SEB service computes the Config Key of the launch file it builds: SHA-256 of the settings as
SEB-JSON (keys sorted case-insensitively, compact, empty dicts dropped, data as base64), in
`launchfile.ConfigKey`. When an exam is locked, that key is added to `accepted_keys` automatically
and `GET .../seb-policy` returns it as `config_key`. Extra keys remain optional. No schema change.

## Consequences

- Locking an exam needs no copy-paste; the downloaded launch file is accepted as is.
- Output matches the exam app's algorithm for the same plist (checked). XML entities are decoded
  before hashing, as SEB does; the exam app hashes them raw.
- Unverified against a real SEB client: confirm one lab machine reaches an exam locked this way
  before relying on it.
