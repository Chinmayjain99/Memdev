# MemDev

MemDev is a developer-focused memory system for intentionally saving useful material encountered while browsing, then finding and revisiting it later. It helps developers and students capture and access useful information efficiently. The project is being built as a web dashboard, a browser extension, and a backend API backed by PostgreSQL.

## Project status

This repository starts from a clean baseline. Implementation status and verified checks are tracked in [docs/progress.md](docs/progress.md). The current architecture plan is in [docs/architecture.md](docs/architecture.md).

## Development prerequisites

- Node.js 22.9 or newer and npm
- PostgreSQL for database-backed development

Copy `backend/.env.example` to `backend/.env` and fill in local-only values. Never commit `.env` or real credentials.

## Development

Install dependencies with `npm install`, copy `backend/.env.example` to `backend/.env`, and set local PostgreSQL credentials. Start the API with `npm run dev`. See [backend/README.md](backend/README.md) and [docs/development-workflow.md](docs/development-workflow.md) for setup and verification commands.

## Privacy and security

MemDev is intended to save only content a user deliberately selects and submits. Authentication and authorization must be enforced by the backend, with every private query scoped to the authenticated user. The extension must use minimal permissions and protect sensitive sites.
