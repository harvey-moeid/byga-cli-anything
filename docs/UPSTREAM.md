# Upstream integration record

- Repository: https://github.com/HKUDS/CLI-Anything
- Inspected main commit: `34f519533bc175d2fe287ab8316b0dd99bb9cc43`
- Commit date: 2026-09-22
- License at upstream root: Apache-2.0
- Reviewed entry points: `README.md`, `cli-anything-plugin/HARNESS.md`, `cli-anything-plugin/QUICKSTART.md`, `cli-anything-plugin/skill_generator.py`.

## Technical finding

CLI-Anything is an agent-guided harness engineering methodology with command prompts, phases, templates and a Python skill metadata generator. The slash commands such as `/cli-anything`, `/cli-anything:test`, and `/cli-anything:validate` are intended for a coding agent environment. They are not, by themselves, a standalone Python service that a GitHub Actions runner can call to generate a harness.

The BYGA.AI MCP connector is available as a tool interface during repository development, but no callable HTTPS agent-completion endpoint has been verified for a remote GitHub runner. The application therefore supports read-only audit and orchestration while generation fails closed until a genuine BYGA adapter is provided. Do not simulate harness generation or claim the upstream slash commands are executable in Actions.

## Integration approach

1. Keep upstream source unvendored until the required files and subpackage licenses are fully audited.
2. Pin the upstream reference above for reproducible methodology review.
3. Implement a BYGA adapter with a documented request/response contract and bounded file outputs.
4. Invoke the adapter from an ephemeral runner only after endpoint authentication, source-transfer, prompt-injection controls, output-path validation, and contract tests pass.
5. Run generated CLI tests in an isolated environment; store only artifacts for review. No target write token or package-publishing credential is provided.
