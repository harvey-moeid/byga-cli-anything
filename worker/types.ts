export interface D1RunResult { success?: boolean; meta?: { changes?: number } }
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<D1RunResult>;
}
export interface D1Database { prepare(sql: string): D1PreparedStatement }

export interface Env {
  DB: D1Database;
  GITHUB_TOKEN: string;
  JOB_CALLBACK_SECRET: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  /** Worker secret. Must be at least 12 characters; authentication fails closed when absent. */
  APP_PASSWORD?: string;
  /** Exact browser origin allowed to call /api/*. */
  APP_ORIGIN: string;
  /** Strict | Lax | None. Defaults to Lax (same-site deployment). */
  COOKIE_SAMESITE?: string;
}

export type AppEnv = { Bindings: Env; Variables: { actor: string } };
