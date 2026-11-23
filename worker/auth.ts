import type { D1Database } from "./types";

export const SESSION_COOKIE = "__Host-byga_session";
export const OWNER_ID = "owner";
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024;
export const MAX_LOGIN_BODY_BYTES = 4096;
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_IDLE_SECONDS = 24 * 60 * 60;
export const LOGIN_WINDOW_SECONDS = 15 * 60;
export const MAX_FAILURES_PER_CLIENT = 5;
export const MAX_FAILURES_GLOBAL = 30;
export const MAX_ACTIVE_SESSIONS = 10;

const GLOBAL_KEY = "global";
const TOUCH_INTERVAL_SECONDS = 5 * 60;
const SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();

export type SameSite = "Strict" | "Lax" | "None";
export interface Session { id: string; userId: string; csrfToken: string; expiresAt: string }

const isoAt = (ms: number) => new Date(ms).toISOString();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export async function hmacHex(key: string, value: string): Promise<string> {
  const imported = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", imported, encoder.encode(value))));
}

/** Compares two secrets by hashing both to fixed length, so length and prefix do not leak through timing. */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  let mismatch = 0;
  for (let i = 0; i < x.length; i++) mismatch |= x[i] ^ y[i];
  return mismatch === 0;
}

/** 256-bit cryptographically random token, base64url encoded (43 characters). */
export function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Derived, not stored: only the holder of the HttpOnly cookie (the server) can compute it. */
export async function csrfTokenFor(sessionToken: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode("byga-csrf-v1:" + sessionToken));
  return toBase64Url(new Uint8Array(digest));
}

export function resolveSameSite(value: string | undefined): SameSite {
  return value === "Strict" || value === "None" ? value : "Lax";
}

export function sessionCookie(token: string, sameSite: SameSite): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=${sameSite}`;
}

export function clearedSessionCookie(sameSite: SameSite): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=${sameSite}`;
}

export function readSessionToken(cookieHeader: string | undefined | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(index + 1).trim();
    return TOKEN_PATTERN.test(value) ? value : null;
  }
  return null;
}

export async function ensureOwner(db: D1Database, nowMs = Date.now()): Promise<void> {
  const now = isoAt(nowMs);
  await db.prepare("INSERT OR IGNORE INTO users(id,display_name,created_at,updated_at) VALUES(?,?,?,?)")
    .bind(OWNER_ID, "Owner", now, now).run();
}

export async function createSession(
  db: D1Database,
  clientHash: string | null,
  userAgent: string | null,
  nowMs = Date.now(),
): Promise<{ token: string; csrfToken: string; expiresAt: string }> {
  const token = randomToken();
  const created = isoAt(nowMs);
  const expiresAt = isoAt(nowMs + SESSION_TTL_SECONDS * 1000);
  await db.prepare(
    "INSERT INTO sessions(id,token_hash,user_id,created_at,last_seen_at,expires_at,client_hash,user_agent) VALUES(?,?,?,?,?,?,?,?)",
  ).bind(
    crypto.randomUUID(), await sha256Hex(token), OWNER_ID, created, created, expiresAt,
    clientHash, userAgent ? userAgent.slice(0, 200) : null,
  ).run();
  await db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(isoAt(nowMs - SESSION_RETENTION_MS)).run();
  await db.prepare(
    "UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL AND id NOT IN (SELECT id FROM sessions WHERE user_id=? AND revoked_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT ?)",
  ).bind(created, OWNER_ID, OWNER_ID, MAX_ACTIVE_SESSIONS).run();
  return { token, csrfToken: await csrfTokenFor(token), expiresAt };
}

type SessionRow = { id: string; user_id: string; expires_at: string; last_seen_at: string; revoked_at: string | null };

export async function resolveSession(db: D1Database, token: string, nowMs = Date.now()): Promise<Session | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const row = await db.prepare(
    "SELECT id,user_id,expires_at,last_seen_at,revoked_at FROM sessions WHERE token_hash=?",
  ).bind(await sha256Hex(token)).first<SessionRow>();
  if (!row || row.revoked_at) return null;
  if (!(Date.parse(row.expires_at) > nowMs)) return null;
  const lastSeen = Date.parse(row.last_seen_at);
  if (!Number.isFinite(lastSeen) || nowMs - lastSeen > SESSION_IDLE_SECONDS * 1000) return null;
  if (nowMs - lastSeen > TOUCH_INTERVAL_SECONDS * 1000) {
    await db.prepare("UPDATE sessions SET last_seen_at=? WHERE id=? AND revoked_at IS NULL").bind(isoAt(nowMs), row.id).run();
  }
  return { id: row.id, userId: row.user_id, csrfToken: await csrfTokenFor(token), expiresAt: row.expires_at };
}

export async function revokeSession(db: D1Database, sessionId: string, nowMs = Date.now()): Promise<void> {
  await db.prepare("UPDATE sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL").bind(isoAt(nowMs), sessionId).run();
}

export async function revokeAllSessions(db: D1Database, userId: string, nowMs = Date.now()): Promise<number> {
  const result = await db.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL")
    .bind(isoAt(nowMs), userId).run();
  return result.meta?.changes ?? 0;
}

type AttemptWindow = { total: number; oldest: string | null };

async function failureWindow(db: D1Database, key: string, sinceIso: string): Promise<AttemptWindow> {
  const row = await db.prepare(
    "SELECT COUNT(*) AS total, MIN(created_at) AS oldest FROM login_attempts WHERE key_hash=? AND succeeded=0 AND created_at>?",
  ).bind(key, sinceIso).first<{ total: number; oldest: string | null }>();
  return { total: Number(row?.total ?? 0), oldest: row?.oldest ?? null };
}

/** Blocks a client after repeated failures, and everyone after a distributed burst. */
export async function checkLoginRateLimit(
  db: D1Database,
  clientKey: string,
  nowMs = Date.now(),
): Promise<{ allowed: boolean; retryAfter: number }> {
  const since = isoAt(nowMs - LOGIN_WINDOW_SECONDS * 1000);
  const client = await failureWindow(db, clientKey, since);
  const global = await failureWindow(db, GLOBAL_KEY, since);
  let retryAfter = 0;
  const limits: Array<[AttemptWindow, number]> = [[client, MAX_FAILURES_PER_CLIENT], [global, MAX_FAILURES_GLOBAL]];
  for (const [window, limit] of limits) {
    if (window.total < limit) continue;
    const wait = window.oldest
      ? Math.ceil((Date.parse(window.oldest) + LOGIN_WINDOW_SECONDS * 1000 - nowMs) / 1000)
      : LOGIN_WINDOW_SECONDS;
    retryAfter = Math.max(retryAfter, Math.max(1, wait));
  }
  return { allowed: retryAfter === 0, retryAfter };
}

export async function recordLoginAttempt(
  db: D1Database,
  clientKey: string,
  succeeded: boolean,
  nowMs = Date.now(),
): Promise<void> {
  const created = isoAt(nowMs);
  if (succeeded) {
    await db.prepare("DELETE FROM login_attempts WHERE key_hash=? AND succeeded=0").bind(clientKey).run();
    await db.prepare("INSERT INTO login_attempts(key_hash,succeeded,created_at) VALUES(?,1,?)").bind(clientKey, created).run();
  } else {
    await db.prepare("INSERT INTO login_attempts(key_hash,succeeded,created_at) VALUES(?,0,?)").bind(clientKey, created).run();
    await db.prepare("INSERT INTO login_attempts(key_hash,succeeded,created_at) VALUES(?,0,?)").bind(GLOBAL_KEY, created).run();
  }
  await db.prepare("DELETE FROM login_attempts WHERE created_at<?").bind(isoAt(nowMs - ATTEMPT_RETENTION_MS)).run();
}

export async function writeAudit(
  db: D1Database,
  actor: string,
  action: string,
  target: string | null,
  metadata?: Record<string, unknown>,
  nowMs = Date.now(),
): Promise<void> {
  await db.prepare("INSERT INTO audit_events(actor,action,target,metadata_json,created_at) VALUES(?,?,?,?,?)")
    .bind(actor, action, target, metadata ? JSON.stringify(metadata) : null, isoAt(nowMs)).run();
}
