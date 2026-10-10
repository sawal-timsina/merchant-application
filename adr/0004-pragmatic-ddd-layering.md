# ADR 0004: Pragmatic DDD layering

- Status: accepted
- Date: 2026-10-10

## Context

We want clear boundaries and testable business rules without spending the time box on mapping
code. Strict DDD (aggregates separate from ORM entities, mappers, value objects) roughly doubles
the persistence code.

## Decision

One folder per bounded context (`identity`, `applications`, `risk`, `audit`), each layered:

- `domain/`: plain TypeScript with no Nest or TypeORM imports. State machine, CASL policy and
  SQL scope, risk scoring, enums, ports (e.g. `KybProvider`).
- `application/`: services and use cases that own transactions and orchestrate the domain.
- `infrastructure/`: TypeORM entities, queue publishers and processors, external providers.
- `presentation/`: controllers, DTOs with validation, guards, explicit response mappers.

TypeORM entities double as the persistence model. Responses always go through an allow-list
mapper (`toApplicationResponse`), so new columns, such as encrypted fields, are never exposed by
accident.

## Consequences

- The rules reviewers care about are unit-tested without a database.
- The domain model's shape follows the schema; behaviour lives in functions, not entity methods.
- Introduce aggregates and mappers when entities need rich behaviour or invariants spanning
  several tables.
