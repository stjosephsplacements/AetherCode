# ADR-0087: Proprietary licence

Status: accepted (2026-11-19). Supersedes the AGPL v3 licence decision recorded in the original
repository set-up.

## Context

AetherCode was published under the GNU AGPL v3. The owner (St. Joseph's Group of Institutions) wants
to license it to colleges commercially and keep the source confidential.

## Decision

- `LICENSE` is a proprietary licence: use needs a written licence from the owner; copying,
  modification, hosting for third parties, reverse engineering and building a competing product are
  prohibited.
- `NOTICE` states ownership and points to the dependency lists for third-party licences.
- App `package.json` files use `"license": "UNLICENSED"`.
- The public site no longer links the repository, shows the AGPL, or presents the product as open source.
  Security reports go to the configured security email or the college's exam administrator.
- Contributions are accepted only under a written agreement; the owner owns them.

## Consequences

- Versions already published under the AGPL stay available under it to those who received them. The
  licence says so (clause 8); it cannot be withdrawn.
- Nothing may be linked into the Software whose licence forbids proprietary distribution. Before each
  release, generate the Go and npm licence reports and review them. MinIO and similar AGPL products
  run as separate services and are not linked, but a licensee-facing deployment guide must say they keep
  their own licence.
- This ADR is not legal advice. The owner's counsel must approve the licence text and the
  third-party review before the first licensed deployment.
