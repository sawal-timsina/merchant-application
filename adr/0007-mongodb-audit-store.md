# ADR 0007: Optional MongoDB audit store behind a port

- Status: accepted
- Date: 2026-10-10

## Context

Audit data is append-heavy, has flexible per-action metadata, and is mostly read through
aggregations (who decided what, how fast). A document store suits it. But an audit entry must
exist if and only if its action happened, and MongoDB cannot take part in a Postgres transaction:
writing to Mongo after the commit loses the entry if the process dies in between.

## Decision

- `AuditService` writes through an `AuditWriter` port and reads through an `AuditReader` port.
  `AUDIT_STORE=postgres` (default) or `mongo` picks the adapters when modules are defined, because
  it decides whether a Mongo connection is opened at all.
- Postgres adapter: inserts into `audit_logs` inside the caller's transaction (append-only trigger).
- Mongo adapter: the writer puts an `AuditRecorded` event into the transactional outbox in the
  caller's transaction; the worker's relay projects it into the `audit_logs` collection with
  `_id = outbox event id`. A re-relayed event hits the unique `_id` and counts as already done, so
  the projection is exactly-once in effect.
- Append-only in Mongo is enforced by the database: the app connects as `audit_app`, whose custom
  role allows only `find` and `insert` on the collection, and the server runs with `--auth`.
  Indexes are created by the init script as root; the app runs with `autoIndex: false`.
- Both adapters implement the same queries, including the decisions-per-reviewer aggregation
  (`$group`/`$dateToString` in Mongo, `count(*) FILTER` in Postgres), and the same integration
  tests run against both (`integration` and `integration-mongo` Jest projects).

## Consequences

- No lost or phantom audit entries in either mode.
- In Mongo mode the audit view lags the action by up to about one second.
- The port's `write()` takes the transaction's `EntityManager`: a pragmatic coupling, because the
  transaction handle is what guarantees atomicity.
- The local Compose file pins `mongo:7.0`: MongoDB 8.x and 9.x refuse to start on Linux kernels
  6.19 and newer (SERVER-121912).

## Alternatives considered

| Option                                       | Why not                                                           |
| -------------------------------------------- | ----------------------------------------------------------------- |
| Write to Mongo after the Postgres commit     | Entries lost on crash                                             |
| Change data capture (Debezium) from Postgres | Robust, but heavy infrastructure for this scope                   |
| Replace Postgres audit entirely              | Would make an optional dependency mandatory for every environment |
