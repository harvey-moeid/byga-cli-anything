# Operations

Worker vars: GITHUB_OWNER=harvey-moeid, GITHUB_REPO=byga-cli-anything, APP_ORIGIN (exact app origin, for example the Pages or custom-domain URL), COOKIE_SAMESITE (`Lax` default). Worker secrets: **APP_PASSWORD** (at least 12 characters; login is disabled while it is unset), GITHUB_TOKEN (fine-grained token with Actions read/write on the control-plane repository and Contents read only on each approved target repository), JOB_CALLBACK_SECRET (random high-entropy shared secret used only by the Actions-to-Worker callback). D1: create byga-cli-anything in APAC if offered and apply migrations 0001, 0002 and 0003 in order. Set exact D1 ID in wrangler.toml.

Set the password with `wrangler secret put APP_PASSWORD`; never put it in `wrangler.toml`, a `.dev.vars` file that is committed, or a workflow.

## Hosting and cookies

The session cookie is `__Host-` prefixed (HTTPS only, no Domain). Prefer serving the UI and API from the same site (same origin, or a custom domain where a Worker route handles `/api/*`) with `COOKIE_SAMESITE=Lax`. A Pages `*.pages.dev` UI calling a `*.workers.dev` API is cross-site: it requires `COOKIE_SAMESITE=None` and third-party cookies, which some browsers block. Local development over `http://localhost` works in Chromium-based browsers; Safari does not store `Secure` cookies over plain HTTP.

Also set `VITE_API_BASE` at build time when the API is on a different origin, and add Cloudflare rate limiting for `/api/auth/login` before public exposure.

## Rotating the password

Changing `APP_PASSWORD` does not end existing sessions. After rotating, sign in and use Settings > Sign out of all devices, or run `UPDATE sessions SET revoked_at=<now> WHERE revoked_at IS NULL` against D1.

Manual deploy: configure Worker, deploy it manually; build Vite and publish dist to Pages manually; configure origin and cookie settings; smoke test login from Android. No deploy workflow exists. Do not add production deployment automation without explicit approval.

GitHub Actions artifact retention: 7 days. R2 deferred. No cron/Queues/DO. Dashboard polling is 30s; switch to manual refresh/increase interval if D1 read usage grows. Runner minutes only on manual dispatch. Verify current plan quotas/prices before launch; do not assume fixed limits.

Recovery: GitHub source is canonical; recreate D1 from migrations. Export D1 before material changes if history is critical. Prefer forward migrations; code rollback does not reverse schema changes.
