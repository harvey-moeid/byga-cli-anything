# API

All `/api` routes require a valid session cookie except those marked public. State-changing requests (POST, DELETE) must send `Origin` equal to `APP_ORIGIN` and an `X-CSRF-Token` header. Errors: `{error:string}`; never return secrets.

## Authentication
- `POST /api/auth/login` (public) `{password}` -> `200 {authenticated, user, csrfToken, expiresAt}` and sets the session cookie. `400` invalid payload, `401` wrong password, `413` body over 4 KiB, `429` rate limited (`Retry-After`), `503` authentication not configured.
- `GET /api/auth/session` (public) -> `{authenticated:false}` or `{authenticated:true, user, csrfToken, expiresAt}`.
- `POST /api/auth/logout` (public, idempotent) revokes the presented session (needs `X-CSRF-Token` when a session exists) and clears the cookie.
- `POST /api/auth/logout-all` revokes every session -> `{ok, revoked}`.

## Resources
- `GET /api/health` (public)
- `GET /api/dashboard`
- `GET /api/repositories`
- `POST /api/repositories {fullName}`
- `DELETE /api/repositories/:id` (soft disable)
- `GET /api/repositories/:id/branches`
- `POST /api/jobs {repositoryId,ref,task:audit|generate}`
- `GET /api/jobs`, `GET /api/jobs/:id`, `GET /api/jobs/:id/logs`
- `GET /api/artifacts`, `GET /api/artifacts/:artifactId/download?jobId=`
- `GET /api/integrations` and `GET /api/activity`

## Internal
- `POST /internal/job-callback` uses `Authorization: Bearer JOB_CALLBACK_SECRET`; not session based.
