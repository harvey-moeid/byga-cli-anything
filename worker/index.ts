import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./types";

type AppEnv = { Bindings: Env; Variables: { actor: string } };\ntype AppContext = Context<AppEnv>;\ntype GithubRepository = { id: number; owner: { login: string }; name: string; full_name: string; default_branch: string; visibility: string; description: string | null; archived: boolean; disabled: boolean };\ntype GithubBranch = { name: string; commit: { sha: string } };\ntype RepositoryRow = { id: string; full_name: string };\nconst app = new Hono<AppEnv>();
const now = () => new Date().toISOString();

app.use("/api/*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin && origin !== c.env.APP_ORIGIN) return c.json({ error: "Origin not allowed" }, 403);
  await next();
});
app.use("/api/*", cors({
  origin: (origin, c) => origin === c.env.APP_ORIGIN ? origin : "",
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type"],
  maxAge: 600,
}));
app.use("/api/*", async (c, next) => {
  const token = c.req.header("Cf-Access-Jwt-Assertion");
  if (!token) return c.json({ error: "Cloudflare Access authentication required" }, 401);
  try {
    const configured = c.env.ACCESS_TEAM_DOMAIN;
    const teamUrl = new URL(configured.startsWith("http") ? configured : "https://" + configured);
    const jwksUrl = c.env.ACCESS_JWKS_URL || new URL("/cdn-cgi/access/certs", teamUrl).toString();
    const jwks = createRemoteJWKSet(new URL(jwksUrl));
    const { payload } = await jwtVerify(token, jwks, {
      issuer: teamUrl.origin,
      audience: c.env.ACCESS_AUD,
    });
    c.set("actor", String(payload.email || payload.sub || "access-user"));
  } catch {
    return c.json({ error: "Invalid Cloudflare Access identity" }, 401);
  }
  await next();
});

async function github<T = unknown>(c: AppContext, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch("https://api.github.com" + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + c.env.GITHUB_TOKEN,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "BYGA-CLI-Anything",
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(data.message || "GitHub API " + response.status);
  return data as T;
}

async function audit(c: AppContext, action: string, target?: string, metadata?: unknown) {
  await c.env.DB.prepare(
    "INSERT INTO audit_events(actor,action,target,metadata_json,created_at) VALUES(?,?,?,?,?)",
  ).bind(c.get("actor"), action, target || null, metadata ? JSON.stringify(metadata) : null, now()).run();
}

app.get("/api/health", c => c.json({ status: "ok", service: "byga-cli-anything-api", time: now() }));

app.get("/api/dashboard", async c => {
  const [repositories, jobs, artifacts, activity] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) total FROM repositories WHERE allowed=1").first<{ total: number }>(),
    c.env.DB.prepare("SELECT status,COUNT(*) total FROM jobs GROUP BY status").all<Array<{ status: string; total: number }>>(),
    c.env.DB.prepare("SELECT COUNT(*) total FROM jobs WHERE status='COMPLETED'").first<{ total: number }>(),
    c.env.DB.prepare("SELECT id,repository_full_name,task,status,created_at FROM jobs ORDER BY created_at DESC LIMIT 8").all<Array<{ id: string; repository_full_name: string; task: string; status: string; created_at: string }>>(),
  ]);
  return c.json({
    repositories: repositories?.total || 0,
    jobs: jobs.results || [],
    artifacts: artifacts?.total || 0,
    activity: activity.results || [],
  });
});

app.get("/api/repositories", async c => {
  const rows = await c.env.DB.prepare("SELECT * FROM repositories WHERE allowed=1 ORDER BY created_at DESC").all();
  return c.json(rows.results);
});

app.post("/api/repositories", async c => {
  const body = await c.req.json().catch(() => null);
  const fullName = String(body?.fullName || "").trim();
  const parts = fullName.split("/");
  if (parts.length !== 2 || !/^[A-Za-z0-9-]{1,39}$/.test(parts[0]) || !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[1])) {
    return c.json({ error: "Format repository harus owner/name" }, 400);
  }
  try {
    const remote = await github<GithubRepository>(c, "/repos/" + fullName);
    if (remote.archived || remote.disabled) return c.json({ error: "Repository archived/disabled" }, 400);
    const timestamp = now();
    await c.env.DB.prepare(
      "INSERT INTO repositories(id,owner,name,full_name,default_branch,visibility,description,allowed,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?) ON CONFLICT(full_name) DO UPDATE SET default_branch=excluded.default_branch,visibility=excluded.visibility,description=excluded.description,allowed=1,updated_at=excluded.updated_at",
    ).bind(String(remote.id), remote.owner.login, remote.name, remote.full_name, remote.default_branch, remote.visibility, remote.description, timestamp, timestamp).run();
    await audit(c, "repository.allow", remote.full_name);
    return c.json({ id: String(remote.id), fullName: remote.full_name, defaultBranch: remote.default_branch, visibility: remote.visibility }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "GitHub validation failed" }, 502);
  }
});

app.delete("/api/repositories/:id", async c => {
  const row = await c.env.DB.prepare("SELECT full_name FROM repositories WHERE id=?").bind(c.req.param("id")).first<{ full_name: string }>();
  if (!row) return c.json({ error: "Repository not found" }, 404);
  await c.env.DB.prepare("UPDATE repositories SET allowed=0,updated_at=? WHERE id=?").bind(now(), c.req.param("id")).run();
  await audit(c, "repository.disallow", row.full_name);
  return c.json({ ok: true });
});

app.get("/api/repositories/:id/branches", async c => {
  const row = await c.env.DB.prepare("SELECT full_name FROM repositories WHERE id=? AND allowed=1").bind(c.req.param("id")).first<RepositoryRow>();
  if (!row) return c.json({ error: "Repository not allowlisted" }, 404);
  try {
    const branches = await github<GithubBranch[]>(c, "/repos/" + row.full_name + "/branches?per_page=100");
    return c.json(branches.map(branch => ({ name: branch.name, sha: branch.commit.sha })));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "GitHub error" }, 502);
  }
});

app.post("/api/jobs", async c => {
  const body = await c.req.json().catch(() => null);
  const repositoryId = String(body?.repositoryId || "");
  const ref = String(body?.ref || "").trim();
  const task = body?.task;
  if (!repositoryId || !ref || !["audit", "generate"].includes(task)) {
    return c.json({ error: "repositoryId, ref, task wajib diisi" }, 400);
  }
  if (ref.length > 255 || !new RegExp("^[A-Za-z0-9._/-]+$").test(ref) || ref.includes("..")) {
    return c.json({ error: "Ref tidak valid" }, 400);
  }
  const repository = await c.env.DB.prepare("SELECT * FROM repositories WHERE id=? AND allowed=1").bind(repositoryId).first<RepositoryRow>();
  if (!repository) return c.json({ error: "Repository tidak ada dalam allowlist" }, 404);
  const id = crypto.randomUUID();
  const createdAt = now();
  await c.env.DB.prepare(
    "INSERT INTO jobs(id,repository_id,repository_full_name,ref,task,status,created_at) VALUES(?,?,?,?,?,'CREATED',?)",
  ).bind(id, repository.id, repository.full_name, ref, task, createdAt).run();
  await audit(c, "job.create", id, { repository: repository.full_name, ref, task });
  try {
    await github(c, "/repos/" + c.env.GITHUB_OWNER + "/" + c.env.GITHUB_REPO + "/actions/workflows/harness.yml/dispatches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs: { job_id: id, target_repo: repository.full_name, target_ref: ref, task } }),
    });
    await c.env.DB.prepare("UPDATE jobs SET status='QUEUED' WHERE id=?").bind(id).run();
    return c.json({ id, status: "QUEUED" }, 202);
  } catch (error) {
    await c.env.DB.prepare("UPDATE jobs SET status='FAILED',error_message=?,completed_at=? WHERE id=?")
      .bind(error instanceof Error ? error.message : "Dispatch failed", now(), id).run();
    return c.json({ error: error instanceof Error ? error.message : "Workflow dispatch failed" }, 502);
  }
});

app.get("/api/jobs", async c => {
  const rows = await c.env.DB.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50").all<Record<string, unknown>>();
  return c.json(rows.results);
});
app.get("/api/jobs/:id", async c => {
  const row = await c.env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(c.req.param("id")).first();
  return row ? c.json(row) : c.json({ error: "Job not found" }, 404);
});
app.get("/api/integrations", c => c.json({
  github: "worker-secret-required", cloudflare: "worker-active",
  agent: "not-configured", execution: "manual-github-actions",
}));
app.get("/api/activity", async c => {
  const rows = await c.env.DB.prepare("SELECT * FROM audit_events ORDER BY id DESC LIMIT 50").all<Record<string, unknown>>();
  return c.json(rows.results);
});
app.onError((error, c) => {
  console.error("api_error", error.message);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
