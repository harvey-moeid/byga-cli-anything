# BYGA CLI-Anything

Mobile-first control plane for manually auditing custom GitHub repositories and requesting CLI harness generation. Frontend: React/Vite. API: Cloudflare Worker + Hono. Data: D1. Execution: manual GitHub Actions workflow_dispatch.

## Guardrails
- No cron, VPS, long-running server, auto-deploy, auto-publish, auto-merge or target write access.
- Workers only authenticate/orchestrate; Python and harness workloads run on ephemeral GitHub-hosted runners.
- Target source is untrusted. Static audit does not execute target scripts.
- Actions artifacts are the initial artifact store (7-day retention); R2 deferred to avoid duplicate storage.
- Cloudflare Access protects the dashboard; Worker independently validates Access JWT.
- BYGA MCP is not assumed to expose an HTTP agent endpoint. Generation is fail-closed until a compatible endpoint is configured and contract-tested.

## Setup
See docs/OPERATIONS.md. Create D1, apply migrations/0001_init.sql, set Worker vars/secrets, deploy Worker and Pages manually, protect Pages with Access. No deploy workflow is included. Never use production D1 for local tests.

## Development
Node 22+: corepack enable && pnpm install && pnpm dev. Checks: pnpm typecheck, pnpm lint, pnpm test, pnpm build. A committed lockfile is still required before reproducible production builds; the current CI resolves from package.json.

## Docs
PRD, architecture, API, security, operations, BYGA adapter and acceptance criteria are under docs/.

## License
Application code MIT. No upstream harness code is vendored. CLI-Anything upstream remains Apache-2.0; see THIRD_PARTY_NOTICES.md.