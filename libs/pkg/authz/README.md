# authz

The canonical User authorization service loads typed role/scope bindings and
active Casbin policy rows for every decision. This package provides the Casbin
model, five-second HMAC capability envelope, and a no-cache gRPC client used by
protected services before they begin a local RLS transaction.

The capability canonical form exactly matches `authz.set_context` in each
service database: it is audience-bound, carries a one-time capability ID equal
to the Authz decision ID, actor/tenant/revision, and exact action/resource, and
is valid for at most five seconds. Application services receive an opaque
envelope, never its signing key; PostgreSQL performs the authoritative HMAC and
projection check.

`CentralRequest` requires a short-lived `IdentityAssertion` from the trusted
identity-validation flow. The no-cache client forwards it to `authz/v1` and
rejects a response unless the signed capability is bound to the response's
decision ID, principal, tenant, and authorization revision.
