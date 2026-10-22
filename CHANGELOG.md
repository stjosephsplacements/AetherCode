# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are not yet
tagged, so entries are grouped by date. Decisions are in [docs/adr](docs/adr/README.md).

## [Unreleased]

### Added
- Web frontend for students and staff (`frontend/`), a backend-for-frontend over the gateway (ADR-0024).
- Exam-day operations, results and CSV export, regrading, similarity report, audit log and analytics (ADR-0027, 0031, 0039, 0043).
- Question pools, multiple choice, practice problems, lab networks, exam integrity flags and single sign-on (ADR-0030, 0034, 0035, 0037, 0041, 0042).
- Exam calendar, question review and reviewer assignment, college branding, staff "try an exam" (ADR-0044 to 0046).
- Community content: interview experiences, blogs, contest/hackathon/open-source listings, linked coding accounts and tasks (ADR-0048).
- Colleges screen for platform administrators.
- Kubernetes deployment: Helm charts for PKI, backing services, migrations, the eleven services and the frontend, with a secrets generator and install script (ADR-0049).
- Release checklist and community checks in `deploy/single-server`.

### Changed
- A coding question is published only after a model solution passes every test (ADR-0047).
- The README is a front page; platform details moved to `docs/platform-guide.md`; `PLAN.md` moved to `docs/PLAN.md`.

### Migrations
- user `000029`, `000030`; submission `000035`; assessment `000033`; question-bank `000019` to `000021`; notification `000013`.
