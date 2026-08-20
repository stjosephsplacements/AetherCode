# ADR-0001: Go workspace monorepo with hexagonal services

- Status: accepted
- Date: 2026-07-24

## Context

AetherCode has independently deployable services that share contracts and
cross-cutting infrastructure without sharing business persistence.

## Decision

Use a Go workspace with one module per service, shared `libs/pkg` and
`libs/proto` modules, and `domain → app → ports → adapters` dependencies.

## Consequences

Service code remains independently buildable and database ownership remains
explicit. Shared code cannot contain service-specific business rules.
