# Acceptance

- [x] Password login, session cookie, logout, revocation, CSRF/Origin checks and login rate limiting are implemented and covered by automated tests (verified in CI, not yet on a deployment).
- [ ] Login and session behaviour verified on a real deployment (HTTPS, chosen cookie SameSite setting, Android browser).
- [ ] Add/validate repository; allowlist soft-disable.
- [ ] Manual dispatch creates actual Actions run.
- [ ] Audit is metadata-only and does not execute target scripts.
- [ ] Generation calls a configured, tested BYGA adapter or fails closed.
- [ ] Workflow status callback, structured audit report, in-dashboard logs, and artifact download work.
- [ ] No target write credentials, auto-publish, merge or deploy.
- [ ] Build/tests/security/mobile checks pass.
- [ ] Deployment separately approved by owner.
