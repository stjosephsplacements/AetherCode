# authn

Strict Ed25519 compact-JWS identity assertions shared by the Identity service,
protected API services, and the central authorization service. Assertions are
short-lived (at most 15 minutes), have one configured issuer and audience, and
are always verified against an explicit key ID. The package deliberately does
not accept unsecured JWTs, symmetric algorithms, arbitrary issuers, or
unbounded lifetimes.
