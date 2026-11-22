# Architecture

```mermaid
flowchart TD
 A[Android browser] --> B[Cloudflare Access]
 B --> C[Pages static React app]
 C --> D[Cloudflare Worker API]
 D --> E[(D1 metadata)]
 D --> F[GitHub workflow_dispatch]
 F --> G[Ephemeral Actions runner]
 G --> H[Read-only target checkout]
 G --> I[Metadata audit]
 G --> J[Actions artifact]
```

Workers authenticate, validate, orchestrate and persist metadata only. GitHub Actions runs Python. No R2 duplication in MVP; Actions artifacts retained 7 days. Agent adapter is a separate optional HTTP contract; MCP tools are not presumed callable from a runner.
