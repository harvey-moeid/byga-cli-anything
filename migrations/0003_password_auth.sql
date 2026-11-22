PRAGMA foreign_keys=ON;

-- Password-session authentication (single operator, no registration).
--
-- Supersedes the Cloudflare Access identity assumption documented in 0002:
-- the Worker no longer reads an Access assertion. The operator proves
-- knowledge of the APP_PASSWORD Worker secret and receives an opaque session.
--
-- Nothing in this migration stores the password, the session token itself, or
-- a raw client IP address:
--   * sessions.token_hash is SHA-256 (hex) of a 256-bit random token; the token
--     lives only in the HttpOnly cookie.
--   * login_attempts.key_hash is a keyed HMAC of the client address.

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK(expires_at > created_at),
  revoked_at TEXT,
  client_hash TEXT CHECK(client_hash IS NULL OR length(client_hash) <= 64),
  user_agent TEXT CHECK(user_agent IS NULL OR length(user_agent) <= 200)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON sessions(user_id, revoked_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT NOT NULL CHECK(length(key_hash) BETWEEN 1 AND 64),
  succeeded INTEGER NOT NULL CHECK(succeeded IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_key_window ON login_attempts(key_hash, succeeded, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_created ON login_attempts(created_at);
