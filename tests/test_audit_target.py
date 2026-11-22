import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "audit_target.py"

class AuditTargetTests(unittest.TestCase):
    def test_reports_metadata_without_executing_target(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory)
            (target / "LICENSE").write_text("MIT", encoding="utf-8")
            (target / "pyproject.toml").write_text("[project]\nname='sample'\n", encoding="utf-8")
            (target / "src").mkdir()
            (target / "src" / "app.py").write_text("raise RuntimeError('must not execute')\n", encoding="utf-8")
            result = subprocess.run([sys.executable, str(SCRIPT), str(target)], check=True, capture_output=True, text=True)
            report = json.loads(result.stdout)
            self.assertEqual(report["file_count"], 3)
            self.assertIn("LICENSE", report["license_files"])
            self.assertIn("pyproject.toml", report["dependency_manifests"])
            self.assertTrue(report["warnings"])

    def test_missing_target_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = pathlib.Path(directory) / "not-a-directory"
            result = subprocess.run([sys.executable, str(SCRIPT), str(missing)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)

if __name__ == "__main__":
    unittest.main()
