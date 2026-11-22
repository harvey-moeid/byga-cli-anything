import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HASH_A = "a" * 64
HASH_B = "b" * 64


def migrated_connection():
    connection = sqlite3.connect(":memory:")
    connection.execute("PRAGMA foreign_keys=ON")
    for migration in sorted((ROOT / "migrations").glob("*.sql")):
        connection.executescript(migration.read_text(encoding="utf-8"))
    return connection


class MigrationTests(unittest.TestCase):
    def test_all_migrations_apply_in_order(self):
        connection = migrated_connection()
        tables = {
            row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        self.assertTrue({
            "repositories", "jobs", "audit_events", "users", "projects",
            "project_contexts", "ai_tasks", "imported_results", "artifacts",
            "user_settings", "sessions", "login_attempts",
        }.issubset(tables))
        connection.close()

    def test_migrations_are_idempotent(self):
        connection = migrated_connection()
        for migration in sorted((ROOT / "migrations").glob("*.sql")):
            connection.executescript(migration.read_text(encoding="utf-8"))
        connection.close()

    def test_context_versions_and_ai_task_states_are_constrained(self):
        connection = migrated_connection()
        connection.execute(
            "INSERT INTO users(id, created_at, updated_at) VALUES('actor-1','now','now')"
        )
        connection.execute(
            "INSERT INTO projects(id, owner_id, name, created_at, updated_at) "
            "VALUES('project-1','actor-1','Demo','now','now')"
        )
        connection.execute(
            "INSERT INTO project_contexts(id, project_id, version, title, content_markdown, created_by, created_at) "
            "VALUES('ctx-1','project-1',1,'Initial','Context','actor-1','now')"
        )
        with self.assertRaises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO project_contexts(id, project_id, version, title, content_markdown, created_by, created_at) "
                "VALUES('ctx-2','project-1',1,'Duplicate','Context','actor-1','now')"
            )
        with self.assertRaises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO ai_tasks(id, actor_id, provider, task_type, status, title, prompt_markdown, created_at, updated_at) "
                "VALUES('task-1','actor-1','chatgpt','feature','GENERATING','Invalid','Prompt','now','now')"
            )
        connection.close()


class SessionSchemaTests(unittest.TestCase):
    def setUp(self):
        self.connection = migrated_connection()
        self.connection.execute(
            "INSERT INTO users(id, created_at, updated_at) VALUES('owner','t0','t0')"
        )

    def tearDown(self):
        self.connection.close()

    def insert_session(self, session_id, token_hash, created="2026-01-01T00:00:00.000Z", expires="2026-01-08T00:00:00.000Z"):
        self.connection.execute(
            "INSERT INTO sessions(id, token_hash, user_id, created_at, last_seen_at, expires_at) "
            "VALUES(?,?,?,?,?,?)",
            (session_id, token_hash, "owner", created, created, expires),
        )

    def test_session_token_hash_is_unique_and_fixed_length(self):
        self.insert_session("s1", HASH_A)
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_session("s2", HASH_A)
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_session("s3", "too-short")

    def test_session_must_expire_after_creation(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_session(
                "s1", HASH_A,
                created="2026-01-08T00:00:00.000Z", expires="2026-01-01T00:00:00.000Z",
            )

    def test_session_requires_existing_user(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO sessions(id, token_hash, user_id, created_at, last_seen_at, expires_at) "
                "VALUES('s1',?,'missing','a','a','b')",
                (HASH_A,),
            )

    def test_deleting_user_removes_sessions(self):
        self.insert_session("s1", HASH_A)
        self.insert_session("s2", HASH_B)
        self.connection.execute("DELETE FROM users WHERE id='owner'")
        remaining = self.connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
        self.assertEqual(remaining, 0)

    def test_user_agent_length_is_bounded(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO sessions(id, token_hash, user_id, created_at, last_seen_at, expires_at, user_agent) "
                "VALUES('s1',?,'owner','a','a','b',?)",
                (HASH_A, "x" * 201),
            )

    def test_login_attempt_flag_is_constrained(self):
        self.connection.execute(
            "INSERT INTO login_attempts(key_hash, succeeded, created_at) VALUES('k',0,'t')"
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO login_attempts(key_hash, succeeded, created_at) VALUES('k',2,'t')"
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO login_attempts(key_hash, succeeded, created_at) VALUES('',0,'t')"
            )

    def test_schema_has_no_password_or_plain_token_columns(self):
        for table in ("sessions", "login_attempts"):
            columns = {row[1] for row in self.connection.execute(f"PRAGMA table_info({table})")}
            self.assertFalse(columns & {"password", "token", "secret", "ip", "ip_address"}, table)


if __name__ == "__main__":
    unittest.main()
