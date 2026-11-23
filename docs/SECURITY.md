# Security

## Authentication (password session)

Cloudflare Access is **not** used. The single operator signs in with the `APP_PASSWORD` Worker secret; there is no registration and no email.

- **Secret handling:** `APP_PASSWORD` exists only as a Worker secret. It is never stored in D1, source, the frontend, logs or artifacts. It must be at least 12 characters; if it is missing or shorter, login returns 503 (fail closed). Comparison hashes both values to a fixed length before comparing, so length and prefix do not leak through timing.
- **Session token:** 256 bits from `crypto.getRandomValues`, base64url (43 characters). Only its SHA-256 is stored (`sessions.token_hash`); the token itself exists only in the cookie.
- **Cookie:** `__Host-byga_session`, `HttpOnly; Secure; Path=/; Max-Age=604800` with no `Domain`. `SameSite` comes from `COOKIE_SAMESITE` (`Lax` default, `Strict`, or `None`; anything else falls back to `Lax`).
- **Lifetime:** 7 days absolute, 24 hours idle, at most 10 active sessions (older ones are revoked). `last_seen_at` is refreshed at most every 5 minutes to limit D1 writes.
- **Revocation:** `POST /api/auth/logout` revokes the current session; `POST /api/auth/logout-all` revokes every session. Revoked, expired and idle sessions are rejected.
- **CSRF:** every state-changing `/api/*` request needs (a) an `Origin` header equal to `APP_ORIGIN` (a missing Origin is rejected) and (b) an `X-CSRF-Token` header. The token is derived from the session token (`SHA-256("byga-csrf-v1:" + token)`), returned by login and `GET /api/auth/session`, and kept in memory by the UI. Requests that carry a foreign `Origin` are rejected even when they are reads.
- **CORS:** credentials are allowed only for the exact `APP_ORIGIN`. API responses are `Cache-Control: no-store` with `X-Content-Type-Options: nosniff`.
- **Login rate limiting:** failures are counted in D1 per client and globally, over a 15-minute window. Five failures from one client, or 30 across all clients, return 429 with `Retry-After` and block even the correct password until the window passes. A successful login clears that client's failures. The client key is an HMAC (keyed with `APP_PASSWORD`) of `CF-Connecting-IP`; raw addresses are never stored.
- **Audit:** `auth.login`, `auth.login_failed`, `auth.logout` and `auth.logout_all` are recorded without secrets.

### Known limitations

1. **Cross-site hosting.** Pages (`*.pages.dev`) and Workers (`*.workers.dev`) are different sites. `SameSite=Lax` needs the app and API on the same site (same origin, or a custom domain with a Worker route). The fallback `COOKIE_SAMESITE=None` works but depends on third-party cookies, which browsers increasingly block, and then relies on the Origin and CSRF checks alone.
2. **Global lockout can be abused.** A distributed attacker who fails 30 times in 15 minutes blocks the operator's login until the window ends. This trades availability for brute-force resistance. Cloudflare rate limiting in front of the Worker is still recommended.
3. **Changing `APP_PASSWORD` does not revoke existing sessions.** After rotating the password, sign out of all devices (or revoke rows in `sessions`).
4. **Single operator.** `/api/jobs`, `/api/activity` and artifact routes are not scoped per actor; multi-user isolation is a later phase.
5. **Client address.** Rate limiting relies on `CF-Connecting-IP`; when it is absent, all clients share one bucket.

## Other controls

GITHUB_TOKEN is a Worker secret restricted to control-plane repo Actions read/write and Contents read. Runner token is ephemeral GITHUB_TOKEN with contents:read; no target write credential. Server checks the repository allowlist. Source and generated files are untrusted prompt-injection inputs; static audit never runs target code. No tokens in frontend or logs. Review and SHA-pin all Actions before production hardening. Authentication is not a substitute for Cloudflare rate limiting; configure it before public exposure.

## Actions callback boundary

The Worker exposes POST /internal/job-callback outside the `/api/*` middleware so GitHub-hosted runners can report state. The Worker verifies a high-entropy shared secret using a constant-time digest comparison. All `/api/*` routes except `/api/health`, `/api/auth/login`, `/api/auth/logout` and `/api/auth/session` require a valid session. Store the same random secret as Worker JOB_CALLBACK_SECRET and GitHub Actions JOB_CALLBACK_SECRET. Never reuse the GitHub PAT as callback authentication.

Callback body streaming limits and status-transition validation are planned for a later hardening phase.
