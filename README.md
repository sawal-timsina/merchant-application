# Merchant Application Platform

NestJS backend for merchant onboarding: application lifecycle, async risk/KYB review, role- and object-level authorization, audit trail.

## Stack

- Node.js 24, TypeScript 7, NestJS 12, pnpm workspaces
- PostgreSQL 18 + TypeORM, Redis 8 + BullMQ
- Jest 30 (SWC transform) + Supertest
- oxlint, Prettier

## Layout

```
apps/api      NestJS service
packages/     shared packages (none yet)
```

## Getting started

```bash
corepack enable
pnpm install
cp .env.example .env
docker compose up -d
pnpm --filter @merchant/api dev
```

Swagger UI: http://localhost:3000/docs

## Scripts (root)

| Script        | What it does                                |
| ------------- | ------------------------------------------- |
| `pnpm check`  | format check + lint + typecheck + all tests |
| `pnpm build`  | compile all packages                        |
| `pnpm lint`   | oxlint                                      |
| `pnpm format` | Prettier write                              |
| `pnpm test`   | Jest (unit + e2e)                           |

## Tooling notes

TypeScript 7 (native compiler) no longer exposes the JS compiler API, so tools built on it
(`ts-jest`, `ts-node`, the Nest CLI tsc builder) are not used:

- build / typecheck: `tsc` directly
- tests: `@swc/jest` (emits legacy decorator metadata, which NestJS DI needs)
- dev: `tsc --watch` + `node --watch`
