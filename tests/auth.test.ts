import { describe, expect, it } from "vitest";
import app from "../worker/index";
import type { Env } from "../worker/types";

// node:sqlite is loaded through process.getBuiltinModule so the bundler never has to resolve it.
type SqliteStatement = {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number | bigint };
};
type SqliteDatabase = { exec(sql: string): void; prepare(sql: string): SqliteStatement };
const getBuiltin = (id: string): unknown =>
  (process as unknown as { getBuiltinModule(id: string): unknown }).getBuiltinModule(id);
const { DatabaseSync } = getBuiltin("node:sqlite") as { DatabaseSync: new (location: string) => SqliteDatabase };
const fs = getBuiltin("node:fs") as {
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: string): string;
};

const ORIGIN = "https://dashboard.example.com";
const PASSWORD = "correct-horse-battery-staple";
const COOKIE_NAME = "__Host-byga_session";

function createSqlite(): SqliteDatabase {
  const sqlite = new DatabaseSync(":memory:");
  const files = fs.readdirSync("migrations").filter(file => file.endsWith(".sql")).sort();
  for (const file of files) sqlite.exec(fs.readFileSync("migrations/" + file, "utf8"));
  return sqlite;
}

function d1(sqlite: SqliteDatabase) {
  return {
    prepare(sql: string) {
      let params: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { params = values.map(value => (value === undefined ? null : value)); return statement; },
        async first() { return sqlite.prepare(sql).get(...params) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...params) }; },
        async run() { const result = sqlite.prepare(sql).run(...params); return { success: true, meta: { changes: Number(result.changes) } }; },
      };
      return statement;
    },
  };
}

function setup(overrides: Record<string, unknown> = {}) {
  const sqlite = createSqlite();
  const env = {
    DB: d1(sqlite),
    GITHUB_TOKEN: "not-used-in-these-tests",
    GITHUB_OWNER: "harvey-moeid",
    GITHUB_REPO: "byga-cli-anything",
    JOB_CALLBACK_SECRET: "test-callback-secret",
    APP_ORIGIN: ORIGIN,
    APP_PASSWORD: PASSWORD,
    ...overrides,
  } as unknown as Env;
  return { sqlite, env };
}

type Json = Record<string, unknown>;

function login(env: Env, password = PASSWORD, ip = "203.0.113.7", headers: Record<string, string> = {}) {
  return app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": ip, ...headers },
    body: JSON.stringify({ password }),
  }, env);
}

const cookieOf = (response: Response) => (response.headers.get("Set-Cookie") || "").split(";")[0];

async function signIn(env: Env, ip = "203.0.113.7") {
  const response = await login(env, PASSWORD, ip);
  expect(response.status).toBe(200);
  const body = (await response.json()) as Json;
  return { cookie: cookieOf(response), csrf: String(body.csrfToken), response, body };
}

function authed(path: string, cookie: string, init: RequestInit = {}, csrf?: string) {
  const headers: Record<string, string> = { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" };
  if (csrf) headers["X-CSRF-Token"] = csrf;
  return { path, init: { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } } };
}

describe("unauthenticated access", () => {
  it("rejects every protected API route without a session", async () => {
    const { env } = setup();
    for (const path of ["/api/dashboard", "/api/repositories", "/api/jobs", "/api/artifacts", "/api/activity", "/api/integrations", "/api/jobs/abc", "/api/auth/logout-all"]) {
      const response = await app.request(path, { method: path.endsWith("logout-all") ? "POST" : "GET", headers: { Origin: ORIGIN } }, env);
      expect(response.status, path).toBe(401);
    }
    const post = await app.request("/api/jobs", { method: "POST", headers: { Origin: ORIGIN }, body: "{}" }, env);
    expect(post.status).toBe(401);
  });

  it("keeps the health check public and minimal", async () => {
    const { env } = setup();
    const response = await app.request("/api/health", {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  it("reports an anonymous session without failing", async () => {
    const { env } = setup();
    const response = await app.request("/api/auth/session", {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false });
  });

  it("rejects forged or malformed session cookies", async () => {
    const { env } = setup();
    for (const value of ["A".repeat(43), "abc", "", "A".repeat(44)]) {
      const response = await app.request("/api/jobs", { headers: { Origin: ORIGIN, Cookie: COOKIE_NAME + "=" + value } }, env);
      expect(response.status, value).toBe(401);
    }
  });

  it("does not require a session for the GitHub Actions callback", async () => {
    const { env } = setup();
    const denied = await app.request("/internal/job-callback", {
      method: "POST", headers: { Authorization: "Bearer wrong", "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: "x", status: "RUNNING" }),
    }, env);
    expect(denied.status).toBe(401);
    const unknownJob = await app.request("/internal/job-callback", {
      method: "POST", headers: { Authorization: "Bearer test-callback-secret", "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: "x", status: "RUNNING" }),
    }, env);
    expect(unknownJob.status).toBe(404);
  });
});

describe("login", () => {
  it("fails closed when the password secret is missing or too short", async () => {
    for (const APP_PASSWORD of [undefined, "", "short-pass"]) {
      const { env } = setup({ APP_PASSWORD });
      const response = await login(env, "short-pass");
      expect(response.status, String(APP_PASSWORD)).toBe(503);
      expect(response.headers.get("Set-Cookie")).toBeNull();
    }
  });

  it("rejects a wrong password without setting a cookie or echoing it", async () => {
    const { env } = setup();
    const response = await login(env, "definitely-not-it");
    expect(response.status).toBe(401);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await response.text()).not.toContain("definitely-not-it");
  });

  it("issues a hardened session cookie and a CSRF token on success", async () => {
    const { env } = setup();
    const { response, body } = await signIn(env);
    const setCookie = response.headers.get("Set-Cookie") || "";
    expect(setCookie.startsWith(COOKIE_NAME + "=")).toBe(true);
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=604800"]) {
      expect(setCookie).toContain(attribute);
    }
    expect(setCookie).not.toContain("Domain");
    expect(body).toMatchObject({ authenticated: true, user: { id: "owner" } });
    expect(String(body.csrfToken).length).toBeGreaterThanOrEqual(43);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("honours an explicit SameSite setting and ignores unknown values", async () => {
    const none = await login(setup({ COOKIE_SAMESITE: "None" }).env);
    expect(none.headers.get("Set-Cookie")).toContain("SameSite=None");
    const bogus = await login(setup({ COOKIE_SAMESITE: "anything" }).env);
    expect(bogus.headers.get("Set-Cookie")).toContain("SameSite=Lax");
  });

  it("never persists the password or the raw session token", async () => {
    const { env, sqlite } = setup();
    await login(env, "wrong-password-value");
    const { cookie } = await signIn(env);
    const token = cookie.slice(COOKIE_NAME.length + 1);
    const dump = JSON.stringify(["users", "sessions", "login_attempts", "audit_events"].map(table => sqlite.prepare("SELECT * FROM " + table).all()));
    expect(dump).not.toContain(token);
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain("wrong-password-value");
    expect(dump).not.toContain("203.0.113.7");
    expect((sqlite.prepare("SELECT token_hash FROM sessions").get() as { token_hash: string }).token_hash).toHaveLength(64);
  });

  it("validates the payload and bounds its size", async () => {
    const { env } = setup();
    const post = (body: string) => app.request("/api/auth/login", { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body }, env);
    expect((await post("not-json")).status).toBe(400);
    expect((await post(JSON.stringify({ password: 12345 }))).status).toBe(400);
    expect((await post(JSON.stringify({ password: "" }))).status).toBe(400);
    expect((await post(JSON.stringify({ password: "x".repeat(5000) }))).status).toBe(413);
  });

  it("records login and failed-login audit events without secrets", async () => {
    const { env, sqlite } = setup();
    await login(env, "wrong-password-value");
    await signIn(env);
    const actions = (sqlite.prepare("SELECT action FROM audit_events ORDER BY id").all() as Array<{ action: string }>).map(row => row.action);
    expect(actions).toEqual(["auth.login_failed", "auth.login"]);
  });
});

describe("origin and CSRF protection", () => {
  it("rejects state-changing requests with a missing or foreign Origin", async () => {
    const { env } = setup();
    const missing = await app.request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: PASSWORD }) }, env);
    expect(missing.status).toBe(403);
    const foreign = await login(env, PASSWORD, "203.0.113.7", { Origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get("Set-Cookie")).toBeNull();
  });

  it("rejects reads that carry a foreign Origin", async () => {
    const { env } = setup();
    const { cookie } = await signIn(env);
    const response = await app.request("/api/jobs", { headers: { Cookie: cookie, Origin: "https://evil.example" } }, env);
    expect(response.status).toBe(403);
  });

  it("allows an authenticated read", async () => {
    const { env } = setup();
    const { cookie } = await signIn(env);
    const request = authed("/api/jobs", cookie);
    const response = await app.request(request.path, request.init, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("requires a matching CSRF token for state-changing requests", async () => {
    const { env } = setup();
    const { cookie, csrf } = await signIn(env);
    const send = (token?: string) => {
      const request = authed("/api/jobs", cookie, { method: "POST", body: "{}" }, token);
      return app.request(request.path, request.init, env);
    };
    expect((await send()).status).toBe(403);
    expect((await send("wrong-token")).status).toBe(403);
    expect((await send(csrf)).status).toBe(400); // passed authentication and CSRF, failed body validation
  });

  it("returns the CSRF token again from the session endpoint", async () => {
    const { env } = setup();
    const { cookie, csrf } = await signIn(env);
    const request = authed("/api/auth/session", cookie);
    const body = (await (await app.request(request.path, request.init, env)).json()) as Json;
    expect(body).toMatchObject({ authenticated: true, csrfToken: csrf });
  });

  it("allows credentialed CORS only for the application origin", async () => {
    const { env } = setup();
    const preflight = await app.request("/api/jobs", {
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-csrf-token,content-type" },
    }, env);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(preflight.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect((preflight.headers.get("Access-Control-Allow-Headers") || "").toLowerCase()).toContain("x-csrf-token");
    const foreign = await app.request("/api/jobs", { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } }, env);
    expect(foreign.status).toBe(403);
  });
});

describe("session lifecycle", () => {
  it("logout revokes the session server-side and clears the cookie", async () => {
    const { env } = setup();
    const { cookie, csrf } = await signIn(env);
    const request = authed("/api/auth/logout", cookie, { method: "POST" }, csrf);
    const response = await app.request(request.path, request.init, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    const reuse = authed("/api/jobs", cookie);
    expect((await app.request(reuse.path, reuse.init, env)).status).toBe(401);
    const state = authed("/api/auth/session", cookie);
    expect(await (await app.request(state.path, state.init, env)).json()).toEqual({ authenticated: false });
  });

  it("logout without the CSRF token leaves the session intact", async () => {
    const { env } = setup();
    const { cookie } = await signIn(env);
    const request = authed("/api/auth/logout", cookie, { method: "POST" });
    expect((await app.request(request.path, request.init, env)).status).toBe(403);
    const reuse = authed("/api/jobs", cookie);
    expect((await app.request(reuse.path, reuse.init, env)).status).toBe(200);
  });

  it("logout is harmless without a session", async () => {
    const { env } = setup();
    const response = await app.request("/api/auth/logout", { method: "POST", headers: { Origin: ORIGIN } }, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("logout-all revokes every session", async () => {
    const { env } = setup();
    const first = await signIn(env, "203.0.113.10");
    const second = await signIn(env, "203.0.113.11");
    const request = authed("/api/auth/logout-all", first.cookie, { method: "POST" }, first.csrf);
    const response = await app.request(request.path, request.init, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, revoked: 2 });
    for (const cookie of [first.cookie, second.cookie]) {
      const reuse = authed("/api/jobs", cookie);
      expect((await app.request(reuse.path, reuse.init, env)).status).toBe(401);
    }
  });

  it("expires sessions after the absolute lifetime", async () => {
    const { env, sqlite } = setup();
    const { cookie } = await signIn(env);
    sqlite.prepare("UPDATE sessions SET created_at='2020-01-01T00:00:00.000Z', last_seen_at=?, expires_at='2020-01-08T00:00:00.000Z'").run(new Date().toISOString());
    const request = authed("/api/jobs", cookie);
    expect((await app.request(request.path, request.init, env)).status).toBe(401);
  });

  it("expires idle sessions", async () => {
    const { env, sqlite } = setup();
    const { cookie } = await signIn(env);
    sqlite.prepare("UPDATE sessions SET last_seen_at=?").run(new Date(Date.now() - 25 * 3600 * 1000).toISOString());
    const request = authed("/api/jobs", cookie);
    expect((await app.request(request.path, request.init, env)).status).toBe(401);
  });

  it("keeps at most ten active sessions and retains the newest", async () => {
    const { env, sqlite } = setup();
    let latest = "";
    for (let i = 0; i < 12; i++) latest = (await signIn(env, "203.0.113." + (20 + i))).cookie;
    const active = sqlite.prepare("SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL").get() as { n: number };
    expect(active.n).toBe(10);
    const request = authed("/api/jobs", latest);
    expect((await app.request(request.path, request.init, env)).status).toBe(200);
  });
});

describe("login rate limiting", () => {
  it("blocks a client after five failures, even with the right password", async () => {
    const { env } = setup();
    for (let i = 0; i < 5; i++) expect((await login(env, "wrong-password-value", "198.51.100.1")).status).toBe(401);
    const blocked = await login(env, PASSWORD, "198.51.100.1");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Set-Cookie")).toBeNull();
    const retryAfter = Number(blocked.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(900);
    expect((await login(env, PASSWORD, "198.51.100.2")).status).toBe(200);
  });

  it("clears a client's failures after a successful login", async () => {
    const { env } = setup();
    for (let i = 0; i < 4; i++) await login(env, "wrong-password-value", "198.51.100.5");
    expect((await login(env, PASSWORD, "198.51.100.5")).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await login(env, "wrong-password-value", "198.51.100.5")).status).toBe(401);
  });

  it("blocks everyone after a distributed burst of failures", async () => {
    const { env } = setup();
    for (let i = 0; i < 30; i++) expect((await login(env, "wrong-password-value", "192.0.2." + i)).status).toBe(401);
    expect((await login(env, PASSWORD, "192.0.2.200")).status).toBe(429);
  });

  it("lets a client try again once the window has passed", async () => {
    const { env, sqlite } = setup();
    for (let i = 0; i < 5; i++) await login(env, "wrong-password-value", "198.51.100.9");
    expect((await login(env, PASSWORD, "198.51.100.9")).status).toBe(429);
    sqlite.prepare("UPDATE login_attempts SET created_at=?").run(new Date(Date.now() - 16 * 60 * 1000).toISOString());
    expect((await login(env, PASSWORD, "198.51.100.9")).status).toBe(200);
  });
});
