# Security policy

AetherCode runs graded exams and executes untrusted code, so we take reports
seriously.

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub:
[open a private security advisory](https://github.com/AlgoQX/AetherCode/security/advisories/new).

Please include:
- the affected component (service, `apps/exam-v1`, deployment) and version or
  commit;
- steps to reproduce, and what an attacker gains;
- any suggested fix.

We aim to acknowledge a report within 5 working days and to agree a
disclosure date with you once a fix is ready. We credit reporters who want to
be named.

## Scope

In scope, among others:
- bypassing tenant isolation, row-level security or authorization;
- reading hidden tests or another student's code or results;
- escaping the code-execution sandbox or reaching the network from it;
- bypassing Safe Exam Browser enforcement, deadlines or the network allow-list;
- authentication, session or password-handling flaws.

Out of scope: findings that need an already-compromised server or
administrator account, missing hardening on a deployment that ignores the
documented production gates in the [roadmap](docs/roadmap.md), and denial of
service by load alone.

## Supported versions

Only the latest commit on the default branch receives security fixes.
`apps/exam-v1` receives security fixes until it is removed.
