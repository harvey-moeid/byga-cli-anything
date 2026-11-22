# Repository gap analysis — 2026-11-23

## Verified baseline

- Default branch: `main`; HEAD: `9827e98fda992229ae2a9ba6642d96dfc4ae6142`.
- PR #1 is merged; no open PRs or issues were returned.
- Latest CI run #60 completed successfully. Its single `verify` job passed dependency audit, workflow YAML validation, Python syntax/unit tests, TypeScript, ESLint, Vitest, Vite production build, and Wrangler dry-run.
- No `harness.yml` workflow runs were found.
- Repository is public, not archived. Secret scanning and push protection are enabled; Dependabot security updates are disabled.
- BYGA GitHub, Cloudflare, files, skills and browser tool groups are enabled. This confirms tool availability in this session, not an HTTP agent-completion API.

## Implemented and verified

- React/Vite/TypeScript dashboard with repository allowlist, branch listing, manual job dispatch, job history, log viewer and Actions artifact listing/download.
- Cloudflare Worker/Hono API with Access JWT validation, origin/CORS checks, GitHub API integration, D1 metadata, callback secret verification and audit events.
- Manual GitHub Actions workflow with pinned action SHAs, ephemeral hosted runner, read-only checkout, bounded metadata audit, report validation and 7-day artifact retention.
- Static metadata audit does not execute target repository scripts.
- CI workflow has least-privilege `contents: read` permission and uses a Wrangler dry-run rather than deployment.

## Partial foundations / constraints

- Harness generation is deliberately fail-closed because the remote BYGA agent HTTP completion contract is not configured or verified.
- Existing job states are `CREATED/QUEUED/RUNNING/TESTING/COMPLETED/FAILED/CANCELLED`; they do not yet implement the full user-facing lifecycle.
- Existing D1 migration only models repositories, jobs and audit events.
- The current dashboard is a single GitHub control-plane view; there is no implemented dual AI/GitHub workspace.
- No prompt builder, persistent project context, result import/patch staging, PR review UI, branch creation UI, or CLI harness package validation is present.
- UI uses 30-second polling. A PWA service-worker registration exists, but PWA manifest/installability and offline behavior require verification.
- CI installs with `pnpm install --no-frozen-lockfile`; no committed `pnpm-lock.yaml` was found.
- Existing tests cover a small subset of contracts and callback auth; no full D1 migration, Access JWT success/claims, API authorization matrix, upload security, or end-to-end workflow tests were found.

## Security findings to address before production

1. Callback body limit relies on `Content-Length`; requests without that header need a streaming byte limit before JSON parsing.
2. Callback status transitions are not constrained against the current job state; replay/out-of-order callbacks can overwrite state.
3. Manual workflow_dispatch inputs can be supplied directly in GitHub, outside the dashboard allowlist. Workflow-side authorization must be designed explicitly before any broader target access is granted.
4. Rate limiting is documented as a deployment prerequisite but is not implemented/configured in the repository.
5. Artifact download redirects to a GitHub signed URL; confirm the access-control and cache behavior with a deployed Access-protected environment.
6. `/api/jobs` and audit views are not scoped to an actor. Current product model is effectively a single operator; multi-user isolation must be implemented before enabling multiple Access identities.
7. No production D1, Worker, Pages, Access application, domain, or secrets are verified as provisioned. No deployment has been made.

## Upstream CLI-Anything findings

- Upstream root license inspected: Apache-2.0.
- The upstream `HARNESS.md` describes a coding-agent SOP: inspect software architecture, design a stateful/subcommand CLI, implement real backend integration, plan tests before writing them, run tests, validate and package.
- The plugin's slash commands are instructions for a coding-agent environment, not a standalone callable generator service.
- `skill_generator.py` extracts metadata from an already-created harness; it is not the harness implementation engine.
- Existing upstream inspection record pins commit `34f519533bc175d2fe287ab8316b0dd99bb9cc43` (2026-09-22). Revalidate current upstream HEAD and per-harness/dependency licenses before distribution. No upstream code is vendored.

## Priority order

1. Finish schema foundation for users/projects/context/AI tasks/import staging/artifact metadata/settings without destructive changes.
2. Implement manual AI Workspace: ChatGPT/Claude official links, editable prompt templates, task history and truthful WAITING_FOR_USER lifecycle.
3. Implement versioned context manager and safe export/import with secret filtering and bounded sizes.
4. Implement staged result import and diff review; never auto-apply to main.
5. Expand GitHub Workspace and branch/PR review.
6. Implement a real upstream-aligned harness workflow only when a verifiable human-driven AI handoff and isolated test/package pipeline exist.
7. Harden callback transitions, multi-user scoping, rate limits, upload validation and workflow dispatch authorization.
8. Full regression and production-readiness review; deployment remains separately gated by explicit user approval.
