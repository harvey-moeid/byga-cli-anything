PRAGMA foreign_keys=ON;

-- Identity is derived from the verified Cloudflare Access assertion (sub/email).
-- No credentials, provider tokens, or environment values are stored here.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  description TEXT CHECK(description IS NULL OR length(description) <= 2000),
  repository_id TEXT REFERENCES repositories(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, name)
);
CREATE INDEX IF NOT EXISTS idx_projects_owner_updated ON projects(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_contexts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version > 0),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  content_markdown TEXT NOT NULL CHECK(length(content_markdown) <= 200000),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, version)
);
CREATE INDEX IF NOT EXISTS idx_project_contexts_project_version ON project_contexts(project_id, version DESC);

CREATE TABLE IF NOT EXISTS ai_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK(provider IN ('chatgpt','claude','custom')),
  task_type TEXT NOT NULL CHECK(task_type IN ('repository-audit','architecture','feature','bug-fix','refactor','ui-ux','security','performance','testing','documentation','code-review','cli-harness')),
  status TEXT NOT NULL CHECK(status IN ('CREATED','READY','WAITING_FOR_USER','IN_PROGRESS','VALIDATING','PACKAGING','COMPLETED','FAILED','CANCELLED')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  prompt_markdown TEXT NOT NULL CHECK(length(prompt_markdown) <= 100000),
  result_markdown TEXT CHECK(result_markdown IS NULL OR length(result_markdown) <= 500000),
  related_branch TEXT,
  related_commit_sha TEXT,
  error_message TEXT CHECK(error_message IS NULL OR length(error_message) <= 4000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_actor_created ON ai_tasks(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_project_created ON ai_tasks(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_status ON ai_tasks(status);

CREATE TABLE IF NOT EXISTS imported_results (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  format TEXT NOT NULL CHECK(format IN ('markdown','patch','source','zip','test-report')),
  filename TEXT NOT NULL CHECK(length(filename) BETWEEN 1 AND 255),
  content_text TEXT CHECK(content_text IS NULL OR length(content_text) <= 500000),
  storage_key TEXT,
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0 AND size_bytes <= 26214400),
  sha256 TEXT,
  status TEXT NOT NULL CHECK(status IN ('STAGED','VALIDATING','READY_FOR_REVIEW','APPROVED','REJECTED','APPLIED')),
  validation_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_imported_results_actor_created ON imported_results(actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK(provider IN ('github-actions','r2')),
  object_id TEXT NOT NULL,
  filename TEXT NOT NULL CHECK(length(filename) BETWEEN 1 AND 255),
  content_type TEXT,
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0 AND size_bytes <= 26214400),
  sha256 TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(provider, object_id)
);
CREATE INDEX IF NOT EXISTS idx_artifacts_actor_created ON artifacts(actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_settings (
  actor_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
