# ADR-0045: College branding as deployment configuration

- Status: accepted
- Date: 2026-10-21

## Context

A college wants its own name, accent colour and logo in the UI. Every user
sees it, students included, and students can read almost nothing in the
tenant service: their authorization is `self`-scoped per resource, and the
tenant database accepts a context only after its authorization projection
check. Letting students read a tenant row would mean a new `self` rule in
the User service, a branch in `authz.set_context` of the tenant database
(as practice problems needed in Question Bank, ADR-0041) and a second
write path for college administrators. The data is cosmetic and changes a
few times a year.

## Decision

**Branding is a file the operator mounts into the frontend**, not tenant
data. `BRANDING_FILE` names a JSON file with a `default` entry and one entry
per tenant ID; the frontend resolves the signed-in viewer's tenant and
applies the entry over the default. The name replaces "AetherCode" in the
shell, the colour replaces the accent in both themes, and the logo is served
by the frontend from a file beside the config. Nothing in the platform
changes: no migration, no contract and no authorization rule.

**An accent must stay readable.** Only `#rrggbb` colours whose relative
luminance is 0.12 to 0.30 are accepted: they keep at least 3:1 contrast
against the light canvas and about 2.9:1 against the dark one. The button text
colour is chosen by contrast. An invalid colour, name or logo is dropped and
logged, never half-applied.

**The logo is not a path.** The route serves only the file name written in
the config, joined to the config's directory, and the config validator
rejects names with separators. Responses carry `nosniff` and a sandboxing
CSP, so an SVG opened directly cannot run script.

The sign-in page keeps the AetherCode mark: nothing identifies the college
before sign-in.

## Consequences

- Changing branding is an operator task (edit a file), not a college
  administrator's. If colleges need to do it themselves, tenant branding
  columns plus a student-readable endpoint are the follow-up, with the
  authorization work described above.
- Tenant IDs in the file must be kept in step with provisioned tenants.

## Addendum: several logos

A college entry may list up to five logo files in `logos`; the shell shows them
in order, side by side, and `logo` remains the single-file form. Each is served
by index (`/branding/logo?n=i`) under the same rules: configured file names
only, no paths.
