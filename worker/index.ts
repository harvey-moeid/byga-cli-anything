import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./types";

type AppEnv = { Bindings: Env; Variables: { actor: string } };
type AppContext = Context<AppEnv>;
type GithubRepository = { id: number; owner: { login: string }; name: string; full_name: string; default_branch: string; visibility: string; description: string | null; size: number; archived: boolean; disabled: boolean };
type GithubBranch = { name: string; commit: { sha: string } };
type RepositoryRow = { id: string; full_name: string };
const app = new Hono<AppEnv>();
const now = () => new Date().toISOString();

async function sameSecret(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
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

app.post("/internal/job-callback", async c => {
  if (!c.env.JOB_CALLBACK_SECRET) return c.json({ error: "Callback secret is not configured" }, 503);
  const authorization = c.req.header("Authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!supplied || !(await sameSecret(supplied, c.env.JOB_CALLBACK_SECRET))) {
    return c.json({ error: "Unauthorized callback" }, 401);
  }
  const contentLength = Number(c.req.header("Content-Length") || 0);
  if (contentLength > 65536) return c.json({ error: "Callback payload too large" }, 413);
  const body = await c.req.json().catch(() => null);
  const jobId = String(body?.job_id || "");
  const status = String(body?.status || "");
  const allowed = ["RUNNING", "TESTING", "COMPLETED", "FAILED", "CANCELLED"];
  if (!jobId || !allowed.includes(status)) return c.json({ error: "Invalid callback payload" }, 400);
  const existing = await c.env.DB.prepare("SELECT id FROM jobs WHERE id=?").bind(jobId).first<{ id: string }>();
  if (!existing) return c.json({ error: "Unknown job" }, 404);
  await c.env.DB.prepare(
    "UPDATE jobs SET status=?,workflow_run_id=COALESCE(?,workflow_run_id),workflow_url=COALESCE(?,workflow_url),commit_sha=COALESCE(?,commit_sha),error_message=?,result_json=COALESCE(?,result_json),started_at=COALESCE(started_at,?),completed_at=? WHERE id=?",
  ).bind(
    status,
    Number.isInteger(body.workflow_run_id) ? body.workflow_run_id : null,
    typeof body.workflow_url === "string" ? body.workflow_url : null,
    typeof body.commit_sha === "string" ? body.commit_sha : null,
    typeof body.error_message === "string" ? body.error_message.slice(0, 2000) : null,
    body.result_json ? JSON.stringify(body.result_json).slice(0, 20000) : null,
    status === "RUNNING" ? now() : null,
    ["COMPLETED", "FAILED", "CANCELLED"].includes(status) ? now() : null,
    jobId,
  ).run();
  await c.env.DB.prepare("INSERT INTO audit_events(actor,action,target,metadata_json,created_at) VALUES(?,?,?,?,?)")
    .bind("github-actions", "job.status", jobId, JSON.stringify({ status }), now()).run();
  return c.json({ ok: true, job_id: jobId, status });
});



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
    if (remote.size > 512000) return c.json({ error: "Repository exceeds the 500 MiB source limit" }, 413);
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
  await c.env.DB.prepare("DELETE FROM jobs WHERE completed_at IS NOT NULL AND julianday(completed_at) < julianday('now', '-90 days')").run();
  await c.env.DB.prepare("DELETE FROM audit_events WHERE julianday(created_at) < julianday('now', '-180 days')").run();
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
    await c.env.DB.prepare("UPDATE jobs SET status='QUEUED' WHERE id=? AND status='CREATED'").bind(id).run();
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

app.get("/api/jobs/:id/logs", async c => {
  const job = await c.env.DB.prepare(
    "SELECT workflow_run_id,workflow_url FROM jobs WHERE id=?",
  ).bind(c.req.param("id")).first<{ workflow_run_id: number | null; workflow_url: string | null }>();
  if (!job) return c.json({ error: "Job not found" }, 404);
  if (!job.workflow_run_id) return c.json({ error: "Workflow has not started yet" }, 409);
  try {
    const runJobs = await github<{ jobs: Array<{ id: number; name: string; status: string; conclusion: string | null }> }>(
      c,
      "/repos/" + c.env.GITHUB_OWNER + "/" + c.env.GITHUB_REPO + "/actions/runs/" + job.workflow_run_id + "/jobs?per_page=10",
    );
    const logs = await Promise.all(runJobs.jobs.slice(0, 5).map(async item => {
      try {
        const response = await fetch(
          "https://api.github.com/repos/" + c.env.GITHUB_OWNER + "/" + c.env.GITHUB_REPO + "/actions/jobs/" + item.id + "/logs",
          {
            headers: {
              Authorization: "Bearer " + c.env.GITHUB_TOKEN,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "BYGA-CLI-Anything",
            },
            redirect: "manual",
          },
        );
        const location = response.headers.get("Location");
        if (response.status >= 300 && response.status < 400 && location) {
          const logResponse = await fetch(location);
          const text = await logResponse.text();
          return { name: item.name, status: item.status, conclusion: item.conclusion, logs: text.slice(-20000) };
        }
        return { name: item.name, status: item.status, conclusion: item.conclusion, logs: "GitHub log stream unavailable." };
      } catch {
        return { name: item.name, status: item.status, conclusion: item.conclusion, logs: "Unable to retrieve logs." };
      }
    }));
    return c.json({ workflow_url: job.workflow_url, jobs: logs });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Workflow logs unavailable" }, 502);
  }
});

app.get("/api/jobs/:id", async c => {
  const row = await c.env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(c.req.param("id")).first();
  return row ? c.json(row) : c.json({ error: "Job not found" }, 404);
});

app.get("/api/artifacts", async c => {
  const jobs = await c.env.DB.prepare(
    "SELECT id,repository_full_name,workflow_run_id,created_at FROM jobs WHERE workflow_run_id IS NOT NULL ORDER BY created_at DESC LIMIT 10",
  ).all<{ id: string; repository_full_name: string; workflow_run_id: number; created_at: string }>();
  const groups = await Promise.all(jobs.results.map(async job => {
    try {
      const data = await github<{ artifacts: Array<{ id: number; name: string; size_in_bytes: number; expired: boolean; expires_at: string }> }>(
        c,
        "/repos/" + c.env.GITHUB_OWNER + "/" + c.env.GITHUB_REPO + "/actions/runs/" + job.workflow_run_id + "/artifacts",
      );
      return data.artifacts.map(artifact => ({
        ...artifact,
        job_id: job.id,
        repository_full_name: job.repository_full_name,
        workflow_run_id: job.workflow_run_id,
      }));
    } catch {
      return [];
    }
  }));
  return c.json(groups.flat());
});

app.get("/api/artifacts/:artifactId/download", async c => {
  const jobId = c.req.query("jobId") || "";
  const artifactId = Number(c.req.param("artifactId"));
  if (!jobId || !Number.isSafeInteger(artifactId) || artifactId <= 0) {
    return c.json({ error: "Invalid artifact reference" }, 400);
  }
  const job = await c.env.DB.prepare(
    "SELECT workflow_run_id FROM jobs WHERE id=? AND workflow_run_id IS NOT NULL",
  ).bind(jobId).first<{ workflow_run_id: number }>();
  if (!job) return c.json({ error: "Job has no completed workflow run" }, 404);
  try {
    const listed = await github<{ artifacts: Array<{ id: number; expired: boolean }> }>(
      c,
      "/repos/" + c.env.GITHUB_OWNER + "/" + c.env.GITHUB_REPO + "/actions/runs/" + job.workflow_run_id + "/artifacts",
    );
    const artifact = listed.artifacts.find(item => item.id === artifactId);
    if (!artifact || artifact.expired) return c.json({ error: "Artifact not found or expired" }, 404);
    const response = await fetch(
      "https://api.github.com/repos/" + c.env.GITHUB_OWNER + "/" + c.env.GITHUB_REPO + "/actions/artifacts/" + artifactId + "/zip",
      {
        headers: {
          Authorization: "Bearer " + c.env.GITHUB_TOKEN,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "BYGA-CLI-Anything",
        },
        redirect: "manual",
      },
    );
    const location = response.headers.get("Location");
    if (response.status >= 300 && response.status < 400 && location) return c.redirect(location, 302);
    if (!response.ok) return c.json({ error: "GitHub artifact download failed" }, 502);
    return new Response(response.body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="byga-artifact-' + artifactId + '.zip"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return c.json({ error: "Artifact download failed" }, 502);
  }
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
