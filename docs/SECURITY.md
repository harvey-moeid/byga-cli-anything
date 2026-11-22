# Security

Cloudflare Access mandatory; Worker verifies signature, issuer and audience. GITHUB_TOKEN is a Worker secret restricted to control-plane repo Actions read/write and Contents read. Runner token is ephemeral GITHUB_TOKEN with contents:read; no target write credential. Server checks allowlist. Source and generated files are untrusted prompt-injection inputs; static audit never runs target code. No tokens in frontend or logs. Configure Cloudflare rate limiting before public exposure. Review and SHA-pin all Actions before production hardening. Access auth is not a rate limiter.


## Actions callback boundary

The Worker exposes POST /internal/job-callback outside the Access-JWT middleware so GitHub-hosted runners can report state. At the Cloudflare Access edge, bypass only this exact callback path; the Worker verifies a high-entropy shared secret using a constant-time digest comparison. All /api/* routes still require a valid Access JWT. Store the same random secret as Worker JOB_CALLBACK_SECRET and GitHub Actions JOB_CALLBACK_SECRET. Never reuse the GitHub PAT as callback authentication.
