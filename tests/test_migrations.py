import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

class MigrationTests(unittest.TestCase):
    def test_all_migrations_apply_in_order(self):
        connection = sqlite3.connect(":memory:")
        connection.execute("PRAGMA foreign_keys=ON")
        for migration in sorted((ROOT / "migrations").glob("*.sql")):
            connection.executescript(migration.read_text(encoding="utf-8"))
        tables = {
            row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        self.assertTrue({
            "repositories", "jobs", "audit_events", "users", "projects",
            "project_contexts", "ai_tasks", "imported_results", "artifacts",
            "user_settings",
        }.issubset(tables))
        connection.close()

    def test_context_versions_and_ai_task_states_are_constrained(self):
        connection = sqlite3.connect(":memory:")
        connection.execute("PRAGMA foreign_keys=ON")
        for migration in sorted((ROOT / "migrations").glob("*.sql")):
            connection.executescript(migration.read_text(encoding="utf-8"))
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

if __name__ == "__main__":
    unittest.main()
