# Merchant Application Platform

NestJS backend for merchant onboarding: application lifecycle, async risk/KYB review, role- and object-level authorization, audit trail.

## Stack

- Node.js 24, TypeScript 6, NestJS 12, pnpm
- PostgreSQL 18 + TypeORM, Redis 8 + BullMQ
- Jest 30 (SWC transform) + Supertest
- oxlint, Prettier

## Layout

```
src
├── main.ts / app.module.ts         HTTP API entry point and composition root
├── worker.ts / worker.module.ts    background worker (queue processors, scheduled jobs), no HTTP
├── core/                           app-wide infrastructure
│   ├── config/                     zod-validated environment
│   ├── crypto/                     field-level encryption (AES-256-GCM, key rotation)
│   ├── database/                   TypeORM config, naming strategy, migrations
│   ├── outbox/                     transactional outbox
│   └── health/
└── modules/                        one folder per bounded context
    ├── identity/                   users, authentication, refresh tokens
    ├── applications/               merchant application lifecycle and review
    ├── risk/                       asynchronous risk / KYB assessment
    └── audit/                      append-only audit trail
```

Each module is layered:

| Layer             | Contains                                                                          | May depend on       |
| ----------------- | --------------------------------------------------------------------------------- | ------------------- |
| `domain/`         | enums, state machine, policies, repository interfaces. No Nest/TypeORM            | nothing             |
| `application/`    | use cases, DTOs, transactions                                                     | domain              |
| `infrastructure/` | TypeORM entities and repositories, queue producers/processors, external providers | domain, application |
| `presentation/`   | controllers, guards, request/response mapping                                     | application         |

TypeORM entities double as the persistence model (no separate domain classes and mappers):
the business rules that matter live in plain, framework-free `domain/` code, which keeps
them unit-testable without the extra mapping layer.

The API and the worker are built from the same code but run as separate processes
(`dist/main.js`, `dist/worker.js`), so background work scales and fails independently of
request handling.

## Getting started

```bash
corepack enable
pnpm install
cp .env.example .env
echo "FIELD_ENCRYPTION_KEYS=v1:$(openssl rand -base64 32)" >> .env
docker compose up -d          # or: podman compose up -d
pnpm migration:run
pnpm dev   # api + worker
```

Swagger UI: http://localhost:3000/docs

## Scripts

| Script        | What it does                                |
| ------------- | ------------------------------------------- |
| `pnpm check`  | format check + lint + typecheck + all tests |
| `pnpm build`  | compile to `dist/`                          |
| `pnpm lint`   | oxlint                                      |
| `pnpm format` | Prettier write                              |
| `pnpm test`   | Jest (unit + integration)                   |

## Tooling notes

The toolchain is kept minimal, with no Nest CLI, `ts-node` or `ts-jest`:

- build / typecheck: `tsc` directly
- tests: `@swc/jest`, which transpiles without type-checking (fast; `pnpm typecheck` covers
  types) and emits the legacy decorator metadata NestJS DI needs
- dev: `tsc --watch` + `node --watch`

NestJS 12 and TypeORM 1.x ship as ES modules. The app stays CommonJS and loads them through
Node 24's `require(esm)`. Jest only enables that path when Node runs with
`--experimental-vm-modules`, which is why the `test` script passes it.

## Testing

| Script                  | Runs                                                                         |
| ----------------------- | ---------------------------------------------------------------------------- |
| `pnpm test:unit`        | `src/**/*.spec.ts`: pure logic, no I/O                                       |
| `pnpm test:integration` | `test/**/*.integration-spec.ts`: Supertest against the real app and Postgres |
| `pnpm test`             | both                                                                         |

Integration tests boot the real `AppModule` with the production HTTP pipeline
(`test/utils/test-app.ts`) and send requests in-process with Supertest. They run against a
separate `merchant_test` database that is rebuilt from the migrations at the start of every
run, and a dedicated Redis DB that is flushed at the same time. Tests isolate themselves with
unique data (e.g. random emails) rather than truncating tables, because `audit_logs` is
append-only even in tests. Test files run one at a time: they share the outbox table and the
queues, and suites that start an in-process worker would otherwise process each other's jobs.

## Database & migrations

Schema changes go through reviewed migrations only (`synchronize` is always off).

| Script                                                        | What it does                               |
| ------------------------------------------------------------- | ------------------------------------------ |
| `pnpm migration:run`                                          | apply pending migrations                   |
| `pnpm migration:revert`                                       | roll back the last migration               |
| `pnpm migration:show`                                         | list applied / pending                     |
| `pnpm schema:log`                                             | SQL needed to match entities (drift check) |
| `pnpm migration:generate src/core/database/migrations/<Name>` | draft a migration from entity changes      |

Workflow for a schema change:

1. Change the entity.
2. `migration:generate` to draft SQL, then **review and edit it by hand** (the generator
   misses things like extensions, triggers and shared enum types).
3. Register the class in `src/core/database/migrations/index.ts`. Migrations are listed
   explicitly, not globbed, so the CLI, the app and Jest all load the same list.
4. `migration:run`, then `migration:revert` and `migration:run` again to prove `down()` works.

The integration suite rebuilds the `merchant_test` database from the migrations on every run,
so a migration that fails to apply fails the tests. Use `pnpm schema:log` to check that the
migrations and the entity metadata agree (it should report no pending queries).

Conventions: snake_case names, readable constraint names (`pk_users`,
`fk_merchant_applications_created_by_id`, `idx_…`, `chk_…`), money as `bigint` cents,
`timestamptz` everywhere, `audit_logs` append-only (enforced by a trigger).

# The trade-offs (README section content)

These are written as "chose X over Y, the cost, and what production would do". They're the decisions made so far, and the questions reviewers are most likely to probe:

Architecture

1. Single package with two processes (API and worker) over a monorepo or microservices. One build and no version skew between the job producer and consumer. The cost is that module boundaries are enforced by convention, not by the build. The next step would be apps/worker with shared packages once separate release cycles are needed.
2. Pragmatic DDD: TypeORM entities double as the domain model. Business rules (state machine, policies, scoring) are framework-free and unit-tested, without a mapper layer. The cost is that the domain model is shaped by the ORM. You'd introduce aggregates and mappers if the domain grows richer behaviour.

Data 3. Integer cents as bigint over numeric or floats. Exact and fast. The cost is that currencies with three decimal places need a per-currency scale. 4. Postgres for audit, with an append-only trigger. One store, transactional with the action. Mongo is the optional alternative through the outbox. 5. A hand-reviewed migration per change, never synchronize. Generated drafts missed extensions, shared enums and triggers.

Async and reliability 6. Transactional outbox over enqueueing after commit. No lost jobs when the process crashes between commit and enqueue. The cost is up to about 1 s extra latency and a polling relay. In production you'd use LISTEN/NOTIFY or CDC. 7. Idempotency in three layers: deterministic job ID, a unique (application, submission) row, and a locked re-check. Costs a little complexity, but gives exactly-once effects on top of BullMQ's at-least-once delivery. 8. Network calls outside DB transactions (two-phase processing). No locks held while waiting on the provider. The cost is a re-check step afterwards. 9. Risk results are eventually consistent. After submitting, the client sees SUBMITTED/PENDING until the worker finishes.

Security 10. 404 (not 403) for resources outside your scope. Doesn't reveal which IDs exist. The cost is that debugging is slightly less obvious. 11. ADMIN can't record decisions. Follows the brief's wording, "only the assigned REVIEWER", and keeps decision and assignment powers separate. 12. HS256 JWT plus rotating refresh tokens with strict reuse detection. Simple for one service. The cost is that a double refresh logs the user out. Multi-service setups would use RS256/JWKS and maybe a short reuse grace period. 13. Application-level AES-GCM for the tax ID, with the key from env. In production you'd use KMS envelope encryption. Email and phone are masked but not encrypted, because encrypting them would require a blind index to keep searching by them possible.

Testing 14. Integration tests against real Postgres and Redis (Compose) over mocks or Testcontainers. High confidence and fast locally. The cost is that infrastructure must be running.

Scope (prioritization) 15. Built the core end to end before the optional items. Webhook and Mongo are Part 2. WebSockets, MFA/SSO and row-level security are deliberately out of scope, with a note on how each would fit.
