import { Hono, type Context } from "hono";
import type { AppEnv } from "./types";
import {
  MAX_LOGIN_BODY_BYTES,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  checkLoginRateLimit,
  clearedSessionCookie,
  constantTimeEqual,
  createSession,
  ensureOwner,
  hmacHex,
  readSessionToken,
  recordLoginAttempt,
  resolveSameSite,
  resolveSession,
  revokeAllSessions,
  revokeSession,
  sessionCookie,
  writeAudit,
  type Session,
} from "./auth";

type AppContext = Context<AppEnv>;

export async function sessionFromContext(c: AppContext): Promise<Session | null> {
  const token = readSessionToken(c.req.header("Cookie"));
  return token ? resolveSession(c.env.DB, token) : null;
}

export async function hasValidCsrf(c: AppContext, session: Session): Promise<boolean> {
  const supplied = c.req.header("X-CSRF-Token") || "";
  return supplied.length > 0 && constantTimeEqual(supplied, session.csrfToken);
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/login", async c => {
  const password = c.env.APP_PASSWORD;
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return c.json({ error: "Authentication is not configured" }, 503);
  }
  if (Number(c.req.header("Content-Length") || 0) > MAX_LOGIN_BODY_BYTES) {
    return c.json({ error: "Request too large" }, 413);
  }
  const raw = await c.req.text();
  if (raw.length > MAX_LOGIN_BODY_BYTES) return c.json({ error: "Request too large" }, 413);
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  const supplied = (body as { password?: unknown } | null)?.password;
  if (typeof supplied !== "string" || supplied.length === 0 || supplied.length > MAX_PASSWORD_LENGTH) {
    return c.json({ error: "Invalid request" }, 400);
  }

  const clientKey = await hmacHex(password, "login-client:" + (c.req.header("CF-Connecting-IP") || "unknown"));
  const limit = await checkLoginRateLimit(c.env.DB, clientKey);
  if (!limit.allowed) {
    c.header("Retry-After", String(limit.retryAfter));
    return c.json({ error: "Too many login attempts. Try again later." }, 429);
  }

  if (!(await constantTimeEqual(supplied, password))) {
    await recordLoginAttempt(c.env.DB, clientKey, false);
    await writeAudit(c.env.DB, "anonymous", "auth.login_failed", null, { client: clientKey.slice(0, 12) });
    return c.json({ error: "Invalid password" }, 401);
  }

  await recordLoginAttempt(c.env.DB, clientKey, true);
  await ensureOwner(c.env.DB);
  const session = await createSession(c.env.DB, clientKey, c.req.header("User-Agent") || null);
  await writeAudit(c.env.DB, "owner", "auth.login", null, { client: clientKey.slice(0, 12) });
  c.header("Set-Cookie", sessionCookie(session.token, resolveSameSite(c.env.COOKIE_SAMESITE)));
  return c.json({ authenticated: true, user: { id: "owner" }, csrfToken: session.csrfToken, expiresAt: session.expiresAt });
});

// Reports state without failing, so the UI can decide between the login form and the dashboard.
authRoutes.get("/session", async c => {
  const session = await sessionFromContext(c);
  if (!session) return c.json({ authenticated: false });
  return c.json({ authenticated: true, user: { id: session.userId }, csrfToken: session.csrfToken, expiresAt: session.expiresAt });
});

// Always clears the cookie; revokes the stored session when one is presented and the CSRF token matches.
authRoutes.post("/logout", async c => {
  const session = await sessionFromContext(c);
  if (session) {
    if (!(await hasValidCsrf(c, session))) return c.json({ error: "Invalid CSRF token" }, 403);
    await revokeSession(c.env.DB, session.id);
    await writeAudit(c.env.DB, session.userId, "auth.logout", session.id);
  }
  c.header("Set-Cookie", clearedSessionCookie(resolveSameSite(c.env.COOKIE_SAMESITE)));
  return c.json({ ok: true });
});

// Requires an authenticated session and CSRF token (enforced by the /api/* middleware).
authRoutes.post("/logout-all", async c => {
  const actor = c.get("actor");
  const revoked = await revokeAllSessions(c.env.DB, actor);
  await writeAudit(c.env.DB, actor, "auth.logout_all", null, { revoked });
  c.header("Set-Cookie", clearedSessionCookie(resolveSameSite(c.env.COOKIE_SAMESITE)));
  return c.json({ ok: true, revoked });
});
