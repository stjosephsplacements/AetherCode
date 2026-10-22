# ADR-0042: Single sign-on through the college's ZITADEL

- Status: accepted
- Date: 2026-10-20

## Context

The college runs several apps on the campus server, each with its own
accounts: AetherCode, Placement Readiness, the LMS (LearnHouse) and others.
Students should sign in once for all of them. The server already runs
ZITADEL at `sso.stjosephsplacements.in`. An account may first be created in
any of the apps, but a person must never end up with two accounts.

## Decision

**ZITADEL is the single sign-on provider. AetherCode is an OIDC client.**
Identity runs the authorization-code flow with PKCE. Its `POST
/v1/auth/sso/start` returns the authorization URL, state and code verifier.
The frontend keeps the state and verifier in a short-lived cookie bound to
the browser, and checks the state on return. `POST /v1/auth/sso/callback`
exchanges the code at the token endpoint with the client secret, then reads
the user from the userinfo endpoint. Both calls go straight to the provider
over TLS, so no ID token is verified locally and no JWT library is added.

**Sign-in is linking, never creation.** The provider's user signs in as the
AetherCode account with the same username (any `@domain` the provider adds
is dropped). That provider subject is then linked to the account
(`identity.sso_links`). Later sign-ins match on the subject, so renaming the
user in the provider does not matter. Sign-in is refused if:

- the account is linked to a different subject, so a username reused in the
  provider cannot take over an account;
- the account is disabled;
- no AetherCode account has that username.

AetherCode accounts carry a college, roles and batches that only staff
assign, so sign-in never creates one. Password lockout does not apply to an
SSO sign-in, because the provider checked the password.

**Accounts flow into the provider without duplicates.** Database triggers
queue an account in `identity.sso_directory_sync` whenever its password hash
is set, or its username, name or email changes. This covers every path:
provisioning, reissue, reset and change. A worker, enabled by
`IDENTITY_SSO_ADMIN_TOKEN_FILE`, copies each queued account to the provider:

- If the provider already has the username (created in another app), the
  worker links to it and leaves its password alone.
- Otherwise it creates the user with AetherCode's Argon2id hash. ZITADEL
  imports the hash once its `argon2` verifier is enabled, and rehashes it on
  first use.
- For accounts AetherCode created, it keeps later password changes in step.

Only hashes leave AetherCode. Failures retry with backoff, up to 6 hours. An
account without an email gets `<username>@IDENTITY_SSO_EMAIL_DOMAIN`, because
ZITADEL requires an email.

**The AetherCode password stays.** Lab exams in Safe Exam Browser must not
depend on the provider, so the username and password form remains on the
login page under the SSO button. The button appears only when the frontend
has `AETHERCODE_SSO=on`.

## Consequences

- A student's first SSO password is their AetherCode password. Changing it
  in AetherCode updates the provider; changing it in the provider does not
  update AetherCode's fallback password.
- Other apps (LMS, Placement Readiness, the planned ERP) join by becoming
  OIDC clients of the same provider and linking by username in the same way.
- Enabling SSO in production needs:
  - ZITADEL's argon2 verifier;
  - an OIDC web application with redirect URI
    `<PUBLIC_ORIGIN>/auth/sso/callback`;
  - a service user with the Org Owner role and a personal access token.

  See `deploy/single-server/README.md`.
- Tests run against a disposable ZITADEL (build tag `zitadel`). They cover
  hash import and sign-in, update, linking and a full code flow, including
  a wrong PKCE verifier being refused.
