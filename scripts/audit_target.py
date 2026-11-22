#!/usr/bin/env python3
"""Read-only metadata audit; does not import or execute target repository code."""
import json,pathlib,sys
root=pathlib.Path(sys.argv[1]).resolve()
if not root.is_dir():raise SystemExit("target checkout missing")
ignored={"node_modules","vendor",".venv","venv","dist","build","__pycache__"}
files=[p for p in root.rglob("*") if p.is_file() and ".git" not in p.parts and not any(x in ignored for x in p.parts)]
manifest={"pyproject.toml","setup.py","setup.cfg","requirements.txt","package.json","Cargo.toml","go.mod","pom.xml","build.gradle","Gemfile"}
licenses=[p for p in files if p.name.lower().startswith(("license","copying","notice"))]
deps=[p for p in files if p.name in manifest]
wf=list((root/".github/workflows").glob("*.yml"))+list((root/".github/workflows").glob("*.yaml")) if (root/".github/workflows").exists() else []
counts={}
for p in files:counts[p.suffix.lower() or "[no extension]"]=counts.get(p.suffix.lower() or "[no extension]",0)+1
print(json.dumps({"file_count":len(files),"extension_counts":counts,"license_files":[str(p.relative_to(root)) for p in licenses],"dependency_manifests":[str(p.relative_to(root)) for p in deps],"workflow_files":[str(p.relative_to(root)) for p in wf],"warnings":["Metadata-only audit. Does not resolve dependencies, execute code, scan vulnerabilities, or conclude license compatibility."]},indent=2))
