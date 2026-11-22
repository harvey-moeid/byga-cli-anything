# Repository gap analysis

Originally verified 2026-11-23 on `main` `9827e98`; updated for Phase 1 (password authentication, PR #3).

## Verified baseline

- Default branch `main`. PR #1 and PR #2 are merged (PR #2 merge commit `d3cc9a0`); CI run #62 on `main` succeeded.
- CI runs a single `verify` job: dependency audit, workflow YAML validation, Python syntax/unit tests, TypeScript, ESLint, Vitest, Vite production build and a Wrangler dry-run.
- No `harness.yml` workflow runs exist.
- Repository is public, not archived. Secret scanning and push protection are enabled; Dependabot security updates are disabled.
- BYGA GitHub, Cloudflare, files, skills and browser tool groups are enabled. This confirms tool availability in a session, not an HTTP agent-completion API.

## Implemented and verified

- React/Vite/TypeScript dashboard with repository allowlist, branch listing, manual job dispatch, job history, log viewer and Actions artifact listing/download.
- Cloudflare Worker/Hono API, GitHub API integration, D1 metadata, callback secret verification and audit events.
- **Phase 1:** password-session authentication replacing Cloudflare Access (login, logout, logout-all, session status, HttpOnly `__Host-` cookie, derived CSRF token, exact Origin check, credentialed CORS only for `APP_ORIGIN`, 7-day absolute / 24-hour idle lifetime, 10-session cap, per-client and global login rate limiting, audit events). Covered by 29 Worker tests that run against SQLite with the real migrations, plus Python schema tests.
- Manual GitHub Actions workflow with pinned action SHAs, ephemeral hosted runner, read-only checkout, bounded metadata audit, report validation and 7-day artifact retention.
- Static metadata audit does not execute target repository scripts. CI uses least-privilege `contents: read` and a Wrangler dry-run rather than deployment.

## Partial foundations / constraints

- Harness generation is deliberately fail-closed because the remote BYGA agent HTTP completion contract is not configured or verified.
- Job states are `CREATED/QUEUED/RUNNING/TESTING/COMPLETED/FAILED/CANCELLED`; the full user-facing lifecycle is not implemented.
- Migration 0002 models workspace tables, but no endpoints use them yet.
- The dashboard is a single GitHub control-plane view; there is no implemented dual AI/GitHub workspace.
- No prompt builder, persistent project context, result import/patch staging, PR review UI, branch creation UI, or CLI harness package validation is present.
- UI uses 30-second polling. A PWA service-worker registration exists, but manifest/installability and offline behavior require verification.
- CI installs with `pnpm install --no-frozen-lockfile`; no committed `pnpm-lock.yaml` was found.
- Tests do not yet cover upload security, the GitHub-backed routes or end-to-end workflow runs.

## Security findings

Open:

1. Callback body limit relies on `Content-Length`; requests without that header need a streaming byte limit before JSON parsing.
2. Callback status transitions are not constrained against the current job state; replay/out-of-order callbacks can overwrite state.
3. Manual workflow_dispatch inputs can be supplied directly in GitHub, outside the dashboard allowlist. Workflow-side authorization must be designed explicitly before any broader target access is granted.
4. Cloudflare-side rate limiting in front of the Worker is not configured (application-level login limiting exists).
5. Artifact download redirects to a GitHub signed URL; confirm access-control and cache behavior on a deployed environment.
6. `/api/jobs`, `/api/activity` and artifact routes are not scoped per actor; multi-user isolation is required before more than one operator exists.
7. No production D1, Worker, Pages, domain or secrets are verified as provisioned, and `APP_PASSWORD` is not set anywhere. No deployment has been made.
8. Changing `APP_PASSWORD` does not revoke existing sessions (documented in docs/SECURITY.md).
9. Cross-site Pages + workers.dev hosting needs `SameSite=None` and third-party cookies; same-site hosting is recommended.

Resolved in Phase 1: unauthenticated-API risk from relying on an external Access application (the Worker now authenticates every request itself) and the absence of login rate limiting at application level.

## Upstream CLI-Anything findings

- Upstream root license inspected: Apache-2.0. Upstream `main` was still `34f5195` on 2026-11-23, the commit recorded in docs/UPSTREAM.md.
- The upstream `HARNESS.md` describes a coding-agent SOP: inspect software architecture, design a stateful/subcommand CLI, implement real backend integration, plan tests before writing them, run tests, validate and package.
- The plugin's slash commands are instructions for a coding-agent environment, not a standalone callable generator service.
- `skill_generator.py` extracts metadata from an already-created harness; it is not the harness implementation engine.
- No upstream code is vendored. Revalidate upstream HEAD and per-harness/dependency licenses before distribution.

## Priority order

1. ~~Password authentication (Phase 1).~~ Done in PR #3, pending review.
2. Implement manual AI Workspace: ChatGPT/Claude official links, editable prompt templates, task history and truthful WAITING_FOR_USER lifecycle.
3. Implement versioned context manager and safe export/import with secret filtering and bounded sizes.
4. Implement staged result import and diff review; never auto-apply to main.
5. Expand GitHub Workspace and branch/PR review.
6. Implement a real upstream-aligned harness workflow only when a verifiable human-driven AI handoff and isolated test/package pipeline exist.
7. Harden callback transitions, multi-user scoping, rate limits, upload validation and workflow dispatch authorization.
8. Full regression and production-readiness review; deployment remains separately gated by explicit user approval.
