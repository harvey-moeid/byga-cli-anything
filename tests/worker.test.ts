import { describe, expect, it } from "vitest";
import app from "../worker/index";
import type { Env } from "../worker/types";

function mockEnv(secret = "test-callback-secret") {
  const db = {
    prepare: () => ({
      bind() { return this; },
      first: async () => ({ id: "job-123" }),
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
    }),
  };
  return {
    DB: db,
    GITHUB_TOKEN: "not-used-in-these-tests",
    GITHUB_OWNER: "harvey-moeid",
    GITHUB_REPO: "byga-cli-anything",
    ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
    ACCESS_AUD: "test-aud",
    APP_ORIGIN: "https://dashboard.example.com",
    JOB_CALLBACK_SECRET: secret,
  } as unknown as Env;
}

describe("Worker authentication boundary", () => {
  it("rejects API requests without a Cloudflare Access JWT", async () => {
    const response = await app.request("/api/health", {}, mockEnv());
    expect(response.status).toBe(401);
  });

  it("rejects an invalid GitHub Actions callback secret", async () => {
    const response = await app.request("/internal/job-callback", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret", "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: "job-123", status: "RUNNING" }),
    }, mockEnv());
    expect(response.status).toBe(401);
  });

  it("accepts a valid callback and persists the status", async () => {
    const response = await app.request("/internal/job-callback", {
      method: "POST",
      headers: { Authorization: "Bearer test-callback-secret", "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: "job-123", status: "RUNNING", workflow_run_id: 123 }),
    }, mockEnv());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, job_id: "job-123", status: "RUNNING" });
  });
});
