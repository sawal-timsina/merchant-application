# ADR 0001: API and worker as two processes from one codebase

- Status: accepted
- Date: 2026-10-10

## Context

Risk review calls a slow, unreliable third party and is retried with backoff. Running it in the
HTTP process would let job load compete with request handling for the event loop, and a crash in
either would take down both. We still want a single codebase, build and test setup within the
time box.

## Decision

Build one NestJS package with two entry points:

- `src/main.ts` boots `AppModule` (HTTP API). It writes outbox events but never processes jobs.
- `src/worker.ts` boots `WorkerModule` with `NestFactory.createApplicationContext` (no HTTP
  server). It runs the outbox relay, the BullMQ processor and the scheduled reaper.

Both share `CoreModule` (config, logging, TypeORM, queues, encryption) and the module code.
They ship as one image started with different commands.

## Consequences

- The worker scales and restarts independently of the API.
- No version skew: producer and consumer always come from the same build, so job payloads and
  entities cannot drift apart.
- Module boundaries are enforced by convention and review, not by the build.
- The worker image carries API-only dependencies (Swagger, guards); harmless but not minimal.

## Alternatives considered

| Option                                               | Why not                                                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Processor inside the API process                     | Job load and crashes affect request latency and availability                                                                                            |
| `apps/worker` in a monorepo with shared `packages/*` | Requires extracting domain, persistence and config into packages, plus versioned job payloads; worth it with separate teams or release cycles, not here |
| Plain `bullmq` worker script without Nest            | Loses DI, so persistence and use cases would be wired by hand                                                                                           |
