# Development workflow

## Branches

- `main` contains only the initial clean baseline until an explicitly approved release.
- `develop` is the integration branch.
- `codex/<feature>` branches start from `develop` and contain one logical change.

For each feature, implement, run relevant checks, review the diff for secrets and unrelated changes, commit, and push when remote publication is permitted. Merge into `develop` only after relevant checks pass. Never force-push or use destructive reset/clean commands as shortcuts.

## Local configuration

Copy `.env.example` to `.env` and set local values there. Keep `.env`, database dumps, and user data out of Git. Use an isolated test database for integration tests; do not reset the development database.
