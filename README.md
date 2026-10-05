# MemDev

MemDev is a developer-focused memory system for intentionally saving useful material encountered while browsing, then finding and revisiting it later. It helps developers and students capture and access useful information efficiently. The project is being built as a web dashboard, a browser extension, and a backend API backed by PostgreSQL.

## Project status

This repository starts from a clean baseline. Implementation status and verified checks are tracked in [docs/progress.md](docs/progress.md). The current architecture plan is in [docs/architecture.md](docs/architecture.md).

## Development prerequisites

- Node.js 22 or newer and npm
- PostgreSQL for database-backed development

Copy `.env.example` to `.env` and fill in local-only values. Never commit `.env` or real credentials. Database migrations and setup instructions will be added with the backend database phase.

## Development

Application-specific development commands will be documented here as the backend and frontend are implemented. See [docs/development-workflow.md](docs/development-workflow.md) for the branch and checkpoint workflow.

## Privacy and security

MemDev is intended to save only content a user deliberately selects and submits. Authentication and authorization must be enforced by the backend, with every private query scoped to the authenticated user. The extension must use minimal permissions and protect sensitive sites.
