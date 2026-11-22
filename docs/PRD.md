# PRD

Goal: authenticated mobile-first dashboard to allowlist GitHub repositories, manually dispatch audit/generation jobs, monitor status and download artifacts.

Actors: owner/operator; ephemeral GitHub runner; optional BYGA agent HTTP adapter.

Requirements: Access JWT on every API route; server-side repository allowlist; manual workflow_dispatch; Python work only on GitHub-hosted runner; target repo read-only; bounded artifact retention; no auto-deploy/publish/merge; unsupported adapter fails closed.

Non-goals: VPS, 24/7 services, arbitrary shell on Workers, target writes, automatic package release.
