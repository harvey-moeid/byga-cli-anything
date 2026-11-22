# Operations

Worker vars: GITHUB_OWNER=harvey-moeid, GITHUB_REPO=byga-cli-anything, ACCESS_TEAM_DOMAIN, ACCESS_AUD, APP_ORIGIN. Secret: GITHUB_TOKEN (fine-grained, control-plane repository only; Actions read/write, Contents read). D1: create byga-cli-anything in APAC if offered and apply migrations/0001_init.sql. Set exact D1 ID in wrangler.toml.

Manual deploy: configure Worker, deploy it manually; build Vite and publish dist to Pages manually; protect Pages with Cloudflare Access; configure issuer/audience/origin; smoke test from Android. No deploy workflow exists. Do not add production deployment automation without explicit approval.

GitHub Actions artifact retention: 7 days. R2 deferred. No cron/Queues/DO. Dashboard polling is 30s; switch to manual refresh/increase interval if D1 read usage grows. Runner minutes only on manual dispatch. Verify current plan quotas/prices before launch; do not assume fixed limits.

Recovery: GitHub source is canonical; recreate D1 from migrations. Export D1 before material changes if history is critical. Prefer forward migrations; code rollback does not reverse schema changes.
