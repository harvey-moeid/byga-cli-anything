# Cost and Free-plan capacity assessment

Checked against Cloudflare and GitHub documentation on 2026-11-22. Quotas can change; recheck before production.

## Planned monthly platform cost

| Component | Selected approach | Expected charge while inside Free allowance |
|---|---|---:|
| Cloudflare Pages | Static PWA, manual publish | $0 |
| Cloudflare Workers | API/orchestration only; no Python workloads | $0 |
| Cloudflare D1 | One isolated metadata database | $0 |
| Cloudflare R2 | Not provisioned; GitHub Actions artifacts used | $0 |
| GitHub Actions | Standard hosted runner in a public repository | $0 |
| BYGA agent | Not configured; endpoint and billing model unknown | Not estimated |

This is a zero-base-cost design, not a guarantee of zero cost under unlimited usage. Free-plan quotas are enforced and can cause requests/builds to stop when exceeded.

## Relevant quotas

- Workers Free: 100,000 requests/day, 10 ms CPU time per request, 128 MB memory, 50 subrequests/request and 6 simultaneous outgoing connections/request.
- D1 Free: 5 million rows read/day, 100,000 rows written/day, 500 MB maximum per database, 5 GB total account storage, 10 databases/account, and 7-day Time Travel.
- Pages Free: 500 builds/month, one concurrent build, 20-minute build timeout, 20,000 static files and 25 MiB per asset.
- R2 Standard Free allowance: 10 GB-month storage, 1 million Class A operations/month and 10 million Class B operations/month. R2 is not used by this app.
- GitHub Actions standard runners are free for public repositories. GitHub Free includes 500 MB artifact storage; this app retains audit artifacts for 7 days.

## Account capacity observed

- Cloudflare D1 list returned 9 databases. The Free-plan limit is 10, so one database slot appears available for a dedicated BYGA CLI-Anything database. No existing database is reused.
- Cloudflare Worker list returned 36 Workers; the Free-plan account limit is 100.
- No existing Worker, D1 database or Pages project named BYGA CLI-Anything was found in the account listing.
- No new Cloudflare resource has been created.

## Request-volume estimate

The dashboard currently refreshes three read-only API endpoints every 30 seconds while open. If kept open continuously, that is about 8,640 Worker requests/day (3 × 2,880 refreshes), roughly 8.6% of the 100,000/day Workers Free allowance. A single operator's ordinary use should be comfortably below the limit. Avoid increasing the polling frequency.

D1 queries are indexed for job ordering/status. Job metadata cleanup is opportunistic on manual job creation (completed jobs older than 90 days, audit events older than 180 days), so no cron is needed. The artifact list fan-out is capped to five GitHub API calls per request, and log retrieval is capped to five jobs with 20 KB per job.

GitHub Actions runner minutes are consumed only after a manual dispatch. The repository is public, so standard GitHub-hosted runner use is free under GitHub's public-repository policy. Artifact storage remains bounded by the 7-day retention setting and the account's shared storage allowance.

## Operational safeguards

- No R2 duplication while Actions artifacts satisfy retention needs.
- No cron, queue, Durable Object, VPS or persistent runner.
- Manual dispatch only; no automatic deploy or package publishing.
- Source repository cap: 500 MiB GitHub-reported size, 20,000 files and 512 MiB uncompressed metadata-audit size.
- If usage approaches quotas, reduce polling, shorten retained metadata/artifacts or stop new jobs; do not silently switch to paid resources.

## Official references

- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Pages limits: https://developers.cloudflare.com/pages/platform/limits/
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- R2 pricing: https://developers.cloudflare.com/r2/pricing/
- GitHub Actions billing: https://docs.github.com/en/billing/concepts/product-billing/github-actions
