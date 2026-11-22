# Security

Cloudflare Access mandatory; Worker verifies signature, issuer and audience. GITHUB_TOKEN is a Worker secret restricted to control-plane repo Actions read/write and Contents read. Runner token is ephemeral GITHUB_TOKEN with contents:read; no target write credential. Server checks allowlist. Source and generated files are untrusted prompt-injection inputs; static audit never runs target code. No tokens in frontend or logs. Configure Cloudflare rate limiting before public exposure. Review and SHA-pin all Actions before production hardening. Access auth is not a rate limiter.
