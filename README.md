# Merchant Application Platform

NestJS backend for merchant onboarding. Sales staff create merchant applications; submitting one
triggers an asynchronous risk/KYB review in a background worker; an assigned reviewer then
approves, rejects or requests more information. Every significant action is audited, sensitive
fields are encrypted or masked, and object-level authorization keeps each user to their own data.

## Stack

- Node.js 24, TypeScript 6, NestJS 12, pnpm
- PostgreSQL 18 + TypeORM (reviewed migrations), Redis 8 + BullMQ
- JWT access tokens + rotating refresh tokens, CASL policies, argon2id
- Jest 30 (SWC transform) + Supertest, against real Postgres and Redis
- OpenAPI/Swagger, oxlint, Prettier, Docker/Podman Compose

## Quick start

```bash
corepack enable
pnpm install
cp .env.example .env
# Choose local database credentials (Compose creates Postgres with them on first start):
#   POSTGRES_USER=merchant  POSTGRES_PASSWORD=<anything>  POSTGRES_DB=merchant
# Fill the secrets (they are intentionally empty in the example):
#   JWT_ACCESS_SECRET=$(openssl rand -base64 48)
#   FIELD_ENCRYPTION_KEYS=v1:$(openssl rand -base64 32)
#   KYB_WEBHOOK_SECRETS=$(openssl rand -hex 32)
#   SEED_USER_PASSWORD=<any local password, 12+ chars>
docker compose up -d          # or: podman compose up -d   (Postgres + Redis)
pnpm migration:run
pnpm db:seed                  # admin@, reviewer@, reviewer2@, sales@, sales2@example.com
                              # (more SALES/REVIEWER users: POST /users as ADMIN)
pnpm dev                      # API on :3000 and the worker, both in watch mode
```

Swagger UI: http://localhost:3000/docs. A successful "Try it out" on `POST /auth/login` authorizes
the page automatically (`public/js/swagger-autologin.js`). From the command line:

```bash
curl -s localhost:3000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"sales@example.com","password":"<SEED_USER_PASSWORD>"}'
```

### Run everything in containers

```bash
docker compose --profile app up -d --build   # migrate (one-off), api, worker + Postgres, Redis
curl localhost:3000/api/v1/health
```

The image is built once and started twice: `dist/main.js` for the API and `dist/worker.js` for
the worker. The `migrate` service applies migrations before either starts.

## Scripts

| Script                                     | What it does                                     |
| ------------------------------------------ | ------------------------------------------------ |
| `pnpm dev`                                 | API + worker with `tsc --watch` / `node --watch` |
| `pnpm start` / `pnpm start:worker`         | run the compiled API / worker                    |
| `pnpm check`                               | format check + lint + typecheck + all tests      |
| `pnpm test:unit` / `pnpm test:integration` | unit tests / Supertest integration tests         |
| `pnpm migration:run` / `migration:revert`  | apply / roll back migrations                     |
| `pnpm db:seed`                             | create one user per role (dev only)              |

## Architecture

```
src
├── main.ts / app.module.ts         HTTP API entry point and composition root
├── worker.ts / worker.module.ts    background worker (queue processors, scheduled jobs), no HTTP
├── core/                           app-wide infrastructure
│   ├── config/                     zod-validated environment
│   ├── crypto/                     field-level encryption (AES-256-GCM, key rotation)
│   ├── database/                   TypeORM config, naming strategy, migrations, seed
│   ├── domain/                     domain error types (mapped to HTTP in one place)
│   ├── http/                       global exception filter, pagination, error schema
│   ├── outbox/                     transactional outbox and its relay
│   ├── queue/                      BullMQ connection
│   ├── redaction/                  secret removal and PII masking
│   ├── request-context/            request ids and per-request context (AsyncLocalStorage)
│   └── health/
└── modules/                        one folder per bounded context
    ├── identity/                   users, login, JWT, refresh tokens, guards
    ├── applications/               merchant application lifecycle and review
    ├── risk/                       asynchronous risk / KYB assessment
    └── audit/                      append-only audit trail
```

Each module is layered:

| Layer             | Contains                                                         | May depend on       |
| ----------------- | ---------------------------------------------------------------- | ------------------- |
| `domain/`         | enums, state machine, policies, scoring. No Nest/TypeORM         | nothing             |
| `application/`    | use cases and services, transactions                             | domain              |
| `infrastructure/` | TypeORM entities, queue producers/processors, external providers | domain, application |
| `presentation/`   | controllers, DTOs, guards, response mapping                      | application         |

TypeORM entities double as the persistence model; the rules that matter (state machine,
access policy, risk scoring) are plain functions in `domain/`, unit-tested without a database.

The API and the worker are built from the same code but run as separate processes
(`dist/main.js`, `dist/worker.js`), so background work scales and fails independently of
request handling. See [adr/0001](adr/0001-separate-worker-process.md).

### Request and job flow

Detailed per-endpoint and per-worker sequence diagrams (guards, services, transactions,
queues): [architecture/sequence-diagrams.md](architecture/sequence-diagrams.md).

```
POST /applications/:id/submit
  └─ API: one PG transaction { application → SUBMITTED, submission_version + 1,
                               outbox_events += RiskReviewRequested, audit_logs += … }
worker: OutboxRelay (every 1 s, FOR UPDATE SKIP LOCKED)
  └─ BullMQ "risk-review", jobId risk-review_<applicationId>_<submissionVersion>
worker: RiskReviewProcessor → ProcessRiskReviewUseCase
  ├─ tx 1: lock application, get-or-create assessment, skip if stale or done
  ├─ KYB provider call (no transaction open)
  └─ tx 2: re-lock, re-check, assessment COMPLETED, application → UNDER_REVIEW, audit
  retries exhausted → risk_status FAILED + "risk-review-dlq" → ADMIN POST /risk-review/retry
worker: RiskReviewReaper (every 5 min) re-publishes lost jobs, records unrecorded failures
```

## Domain rules

### Application lifecycle

| From             | Event                 | To               | Who                 |
| ---------------- | --------------------- | ---------------- | ------------------- |
| `DRAFT`          | submit                | `SUBMITTED`      | owning SALES, ADMIN |
| `INFO_REQUESTED` | submit                | `SUBMITTED`      | owning SALES, ADMIN |
| `SUBMITTED`      | risk review completed | `UNDER_REVIEW`   | worker              |
| `UNDER_REVIEW`   | approve               | `APPROVED`       | assigned REVIEWER   |
| `UNDER_REVIEW`   | reject (reason)       | `REJECTED`       | assigned REVIEWER   |
| `UNDER_REVIEW`   | request info (reason) | `INFO_REQUESTED` | assigned REVIEWER   |

Any other transition is refused with `409`. Applications are editable only in `DRAFT` and
`INFO_REQUESTED` (with optimistic locking via `version`); a reviewer can be assigned in
`SUBMITTED`, `UNDER_REVIEW` and `INFO_REQUESTED`. A tax id is required to submit.

### Authorization

| Action                                             | ADMIN | REVIEWER         | SALES    |
| -------------------------------------------------- | ----- | ---------------- | -------- |
| create                                             | ✓     |                  | ✓        |
| read / list                                        | all   | assigned to them | own only |
| update, submit                                     | ✓     |                  | own only |
| assign reviewer                                    | ✓     |                  |          |
| record decision                                    |       | assigned to them |          |
| retry failed risk review                           | ✓     |                  |          |
| create / list / deactivate users (SALES, REVIEWER) | ✓     |                  |          |
| read audit trail                                   | ✓     |                  |          |

Role checks run in a global guard; object-level checks use a CASL policy plus an equivalent SQL
scope, so lists are filtered in the database and a unit test keeps the two consistent. A
resource outside the caller's scope returns `404` (its existence is not revealed); a visible
resource the caller may not act on returns `403`. See
[adr/0003](adr/0003-authorization-policy-and-scoping.md).

## Reliability and idempotency

- **Transactional outbox**: the job is recorded in the same transaction as the submit, so a
  crash can neither lose it nor enqueue one for a rolled-back change
  ([adr/0002](adr/0002-transactional-outbox.md)).
- **Deterministic job ids**: re-publishing an event is a no-op in BullMQ.
- **Unique `(application_id, submission_version)`** on `risk_assessments`: a result can be
  stored once per submission, whatever the delivery count.
- **Two-phase processing**: the provider is called with no transaction open; results are
  written only after re-locking and re-checking.
- **Stale-submission guard**: a job for an older submission is skipped.
- **Retries with exponential backoff** (5 attempts by default), then a dead-letter queue and
  `risk_status = FAILED`; ADMIN can retry.
- **Reaper**: reconciles a job lost from Redis or a failure whose handler crashed.
- **Row locks** serialise concurrent submits and decisions: one wins, the other gets `409`.

## Security and sensitive data

| Field                                        | Classification | Protection                                                                                                            |
| -------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------- |
| `users.password_hash`                        | secret         | argon2id; never selected by default; never logged                                                                     |
| refresh tokens                               | secret         | only SHA-256 hashes stored; rotation with reuse detection revokes the family                                          |
| `merchant_applications.tax_id_encrypted`     | sensitive PII  | **field-level encrypted** (AES-256-GCM, key id per value, AAD bound to the column); API shows last 4                  |
| `owner_email`, `owner_phone`                 | PII            | masked in audit metadata and logs; **candidates for field-level encryption** (needs a blind index to stay searchable) |
| bank / settlement details (not modelled yet) | sensitive      | would require field-level encryption                                                                                  |
| `audit_logs.metadata`                        | internal       | redacted before insert; table is append-only (trigger blocks UPDATE/DELETE/TRUNCATE)                                  |
| Mongo `audit_logs` collection (optional)     | internal       | same redacted entries; app user may only insert and read (`--auth` + custom role)                                     |
| `webhook_events.payload`                     | provider data  | KYB outcome flags and references only; no PII                                                                         |

Also: login rate limiting and equalized timing for unknown emails, a global JWT guard (routes
are private unless marked public), users reloaded on every request so deactivation is
immediate, request logs redact `authorization`, cookies, passwords, refresh tokens and tax ids,
errors never leak internals, and no secrets are committed (`.env.example` holds placeholders).
Responses are built by explicit mappers (e.g. `toApplicationResponse`), never by returning
entities; as a backstop, a global `ClassSerializerInterceptor` strips the `@Exclude()`d
`password_hash`, `tax_id_encrypted` and `token_hash` if an entity is ever returned directly.
See [adr/0005](adr/0005-field-level-encryption.md).

## Optional enhancements

### KYB callback via signed webhook

Set `KYB_MODE=callback`. The worker sends the verification request and parks the assessment as
`AWAITING_CALLBACK`; the provider later calls `POST /api/v1/webhooks/kyb`. In development the simulated
provider delivers that callback itself, signed with the first `KYB_WEBHOOK_SECRETS` entry.

```
X-Kyb-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
```

Signatures are checked on the raw body before validation, with a 5-minute replay window and
secret rotation. Each provider `eventId` is processed once (`webhook_events` unique key); unknown
or superseded references are acknowledged and ignored; a callback that never arrives is failed by
the reaper after `KYB_CALLBACK_TIMEOUT_MS`. Sign a test call:

```bash
BODY='{"eventId":"evt_1","type":"kyb.verification.completed","reference":"<ref>","data":{"businessVerified":true,"watchlistHit":false},"occurredAt":"2026-10-10T00:00:00Z"}'
SIG=$(node -e 'const c=require("crypto");const t=Math.floor(Date.now()/1000);process.stdout.write(`t=${t},v1=`+c.createHmac("sha256",process.argv[1]).update(`${t}.`+process.argv[2]).digest("hex"))' "$KYB_SECRET" "$BODY")
curl -s localhost:3000/api/v1/webhooks/kyb -H 'content-type: application/json' -H "x-kyb-signature: $SIG" -d "$BODY"
```

See [adr/0006](adr/0006-signed-kyb-webhooks.md).

### MongoDB audit store

```bash
docker compose up -d mongo     # creates the insert/find-only audit_app user
# .env: AUDIT_STORE=mongo, MONGO_ROOT_USER=..., MONGO_ROOT_PASSWORD=..., MONGO_APP_PASSWORD=..., MONGO_URI=mongodb://audit_app:...@localhost:27017/merchant?authSource=merchant
```

Audit entries still commit with their action (they ride the outbox) and are projected into Mongo
exactly once by the worker; `GET /audit` and `GET /audit/stats/decisions` read from whichever
store is configured. Compose pins `mongo:7.0` because MongoDB 8.x/9.x refuse to start on Linux
kernels 6.19 and newer. See [adr/0007](adr/0007-mongodb-audit-store.md).

## API overview

Every route is versioned in the URI and served under `/api/v1` (e.g. `POST /api/v1/auth/login`);
paths below are relative to that prefix. Swagger UI (`/docs`, `/docs-json`) is not versioned.
List endpoints return `{ items, total, page, pageSize }`; Swagger documents each with its own
item schema (`@ApiPageResponse(Model)` in `src/core/http/pagination.ts`).

| Method | Path                                    | Purpose                                                     |
| ------ | --------------------------------------- | ----------------------------------------------------------- |
| POST   | `/auth/login`                           | access + refresh token                                      |
| POST   | `/auth/refresh` / `/auth/logout`        | rotate / revoke refresh tokens                              |
| GET    | `/auth/me`                              | current user                                                |
| POST   | `/users`                                | create a SALES or REVIEWER account (ADMIN)                  |
| GET    | `/users?role=&page=&pageSize=`          | list users, e.g. to find reviewer ids (ADMIN)               |
| PATCH  | `/users/:id`                            | deactivate / reactivate a SALES or REVIEWER account (ADMIN) |
| POST   | `/applications`                         | create (DRAFT)                                              |
| GET    | `/applications?status=&page=&pageSize=` | list (scoped, filtered, paginated)                          |
| GET    | `/applications/:id`                     | read                                                        |
| PATCH  | `/applications/:id`                     | update while editable (`version` required)                  |
| POST   | `/applications/:id/submit`              | submit for risk review                                      |
| POST   | `/applications/:id/assign`              | assign a reviewer (ADMIN)                                   |
| POST   | `/applications/:id/decision`            | approve / reject / request info                             |
| POST   | `/applications/:id/risk-review/retry`   | retry a failed risk review (ADMIN)                          |
| GET    | `/audit?entityType=&entityId=&action=`  | audit trail (ADMIN)                                         |
| GET    | `/audit/stats/decisions?from=&to=`      | decisions per reviewer per day (ADMIN)                      |
| POST   | `/webhooks/kyb`                         | signed KYB callback (callback mode)                         |
| GET    | `/health`                               | liveness + database check                                   |

Every error has the shape `{ statusCode, error, message, details?, requestId }`; the
`x-request-id` header ties a response to its logs, audit rows and background jobs.

## Testing

| Script                        | Runs                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `pnpm test:unit`              | `src/**/*.spec.ts`: pure logic, no I/O                                         |
| `pnpm test:integration`       | `test/**/*.integration-spec.ts`: Supertest against the real app and Postgres   |
| `pnpm test`                   | both                                                                           |
| `pnpm test:integration:mongo` | the audit specs again, against the MongoDB audit store (needs `mongo` running) |

Integration tests boot the real `AppModule` with the production HTTP pipeline
(`test/utils/test-app.ts`) and send requests in-process with Supertest. They run against a
separate `merchant_test` database that is rebuilt from the migrations at the start of every
run, and a dedicated Redis DB that is flushed at the same time. Tests isolate themselves with
unique data (e.g. random emails) rather than truncating tables, because `audit_logs` is
append-only even in tests. Test files run one at a time: they share the outbox table and the
queues, and suites that start an in-process worker would otherwise process each other's jobs.

Coverage (`pnpm test:cov`): 96% of lines overall, and 97–100% for every `domain/` folder.

Highlights: SALES users cannot read, update, list or submit another user's application by id;
only the assigned reviewer can decide; concurrent submits, decisions and refreshes have exactly
one winner; risk jobs are retried, deduplicated, dead-lettered and reconciled.

## Database & migrations

Schema changes go through reviewed migrations only (`synchronize` is always off).

Schema overview, relationships, constraints, indexes and enums: [architecture/erd.md](architecture/erd.md).

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
so a migration that fails to apply fails the tests. `pnpm schema:log` checks that migrations
and entity metadata agree (it should report no pending queries).

Conventions: snake_case names, readable constraint names (`pk_users`,
`fk_merchant_applications_created_by_id`, `idx_…`, `chk_…`), money as `bigint` cents,
`timestamptz` everywhere.

## Tooling notes

The toolchain is kept minimal, with no Nest CLI, `ts-node` or `ts-jest`:

- build / typecheck: `tsc` directly
- tests: `@swc/jest`, which transpiles without type-checking (fast; `pnpm typecheck` covers
  types) and emits the legacy decorator metadata NestJS DI needs
- dev: `tsc --watch` + `node --watch`

NestJS 12 and TypeORM 1.x ship as ES modules. The app stays CommonJS and loads them through
Node 24's `require(esm)`. Jest only enables that path when Node runs with
`--experimental-vm-modules`, which is why the `test` script passes it.

## Trade-offs

Each item: what was chosen over what, what it costs, and what production would do.

### Architecture

1. **Single package, two processes (API + worker) over a monorepo or microservices.** One build
   and no version skew between job producer and consumer. Cost: module boundaries are enforced
   by convention, not by the build. Next step: `apps/worker` with shared packages once separate
   release cycles are needed. ([adr/0001](adr/0001-separate-worker-process.md))
2. **Pragmatic DDD: TypeORM entities double as the domain model.** Business rules (state
   machine, policies, scoring) are framework-free and unit-tested, without a mapper layer. Cost:
   the domain model is shaped by the ORM. Introduce aggregates and mappers when behaviour gets
   richer. ([adr/0004](adr/0004-pragmatic-ddd-layering.md))

### Data

3. **Money as integer cents (`bigint`) over `numeric` or floats.** Exact and fast. Cost:
   three-decimal currencies would need a per-currency scale.
4. **Audit in Postgres with an append-only trigger, by default.** One store, transactional with
   the action it records. MongoDB is available as an optional store (item 17).
5. **Hand-reviewed migrations, one per change; `synchronize` never on.** Generated drafts missed
   extensions, shared enum types and triggers, which is why every migration is reviewed,
   reverted and drift-checked.

### Async processing and reliability

6. **Transactional outbox over "commit, then enqueue".** No lost jobs if the process dies
   between the two. Cost: up to ~1 s extra latency and a polling relay. Production:
   LISTEN/NOTIFY or CDC. ([adr/0002](adr/0002-transactional-outbox.md))
7. **Idempotency in three layers:** deterministic job id, a unique (application, submission)
   assessment row, and a locked re-check before writing. BullMQ delivers at least once; the
   effects happen exactly once.
8. **No network I/O inside database transactions.** The provider is called between two short
   transactions, so no row lock is held while waiting on a third party. Cost: a re-check step.
9. **Risk results are eventually consistent.** After submit the client sees `SUBMITTED` with
   risk `PENDING` until the worker finishes; clients poll the application.

### Security

10. **404 rather than 403 for resources outside the caller's scope.** Doesn't reveal which ids
    exist. Cost: slightly less obvious when debugging.
    ([adr/0003](adr/0003-authorization-policy-and-scoping.md))
11. **ADMIN cannot record decisions.** Follows "only the assigned REVIEWER may record a risk
    decision" literally and separates assigning from deciding.
12. **HS256 access tokens plus rotating refresh tokens with strict reuse detection.** Simple for
    a single service. Cost: two concurrent refreshes count as a replay and log the user out.
    Multi-service: RS256/JWKS, possibly a short reuse grace period.
13. **Application-level AES-256-GCM for the tax id, key from env.** Production: KMS envelope
    encryption. Owner email and phone are masked, not encrypted, because encrypting them needs a
    blind index to stay searchable. ([adr/0005](adr/0005-field-level-encryption.md))

### Testing

14. **Integration tests against real Postgres and Redis (Compose) over mocks or
    Testcontainers.** High confidence and fast locally. Cost: the infrastructure must be
    running, and files run serially because they share the outbox and queues.

### Scope and prioritization

15. **Core first, end to end, before optional items.** Out of scope, with how each would fit:
    WebSockets (push status changes to the UI), MFA/SSO (identity module, new guards), row-level
    security (multi-tenant isolation), PDF/CSV exports.

### Optional enhancements

16. **KYB callback via signed webhook, with sync mode kept as the default.** Real KYB is
    asynchronous; holding a job open or polling doesn't scale. Cost: a public endpoint, which needs
    an HMAC signature with the timestamp inside the MAC, a replay window and event-id
    deduplication. Receipt and processing share a transaction (simple, but slow processing would
    delay the provider's 200). Unknown or stale events are acknowledged so the provider stops
    retrying. ([adr/0006](adr/0006-signed-kyb-webhooks.md))
17. **MongoDB audit store behind a port, chosen at boot, Postgres the default.** Mongo can't join
    the Postgres transaction, so entries ride the outbox: atomic with the action and projected
    idempotently, but the audit view lags by up to ~1 s. Append-only is enforced by a
    least-privilege database role (with `--auth` set explicitly) instead of a trigger.
    ([adr/0007](adr/0007-mongodb-audit-store.md))

## AI assistance

An AI coding assistant (Claude Code) was used for scaffolding, implementation and drafting
tests, working from a written plan. Verification:

- Every behaviour is covered by unit tests and Supertest integration tests that run against real
  PostgreSQL and Redis; `pnpm check` (format, lint, typecheck, all tests) is green.
- Each test was run and seen to fail before the implementation existed; tests that passed too
  early were tightened, and a flaky test exposed shared state between test files, fixed by
  running them serially.
- Every migration was applied, reverted and re-applied against Postgres 18, and checked with
  `schema:log` for drift. Generated migration drafts were reviewed and corrected by hand: a
  shared enum type created twice, the missing `citext` extension, `uuid_generate_v4()` replaced
  by the built-in `gen_random_uuid()`, a `jsonb` default that caused permanent drift, and the
  audit append-only triggers the generator cannot express.
- Manual smoke tests through Swagger and `curl` against the running API and worker.
