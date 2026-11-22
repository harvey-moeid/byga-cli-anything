# BYGA agent adapter (BLOCKED pending verified endpoint)

BYGA.AI MCP is a tool interface, not automatically an HTTP API callable from GitHub-hosted runners. No public agent completion endpoint has been verified. Do not invent one. Generation remains disabled until an HTTPS endpoint and bearer secret are configured and contract-tested.

Proposed contract: POST /v1/harness/generate with protocol_version, job_id, target repository/ref/commit, task, strict constraints (target_write_access=false, no_auto_publish=true, max_output_bytes), upstream repo and methodology path. Response must be JSON containing status=completed, generated files as base64 or a bounded archive, and test report. Validate paths, size, response schema and tests before artifact upload. Non-200, malformed output, timeout or partial results fail closed. Never pass target write credentials.
