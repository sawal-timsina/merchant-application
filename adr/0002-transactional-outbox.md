# ADR 0002: Transactional outbox for enqueueing risk reviews

- Status: accepted
- Date: 2026-10-10

## Context

Submitting an application must change its status **and** enqueue a risk-review job. Postgres and
Redis cannot share a transaction. "Commit, then enqueue" loses the job if the process dies
between the two; "enqueue, then commit" can run a job for a submit that later rolls back.

## Decision

The submit transaction also inserts a row into `outbox_events` (`RiskReviewRequested`, payload
`{applicationId, submissionVersion}`, correlation id). A relay in the worker polls every second:

```sql
SELECT … FROM outbox_events
WHERE processed_at IS NULL AND available_at <= now()
ORDER BY available_at LIMIT 50
FOR UPDATE SKIP LOCKED
```

It hands each event to the registered publisher and marks it processed in the same transaction.
Failures increment `attempts`, store `last_error` and push `available_at` back exponentially
(1 s doubling, capped at 5 minutes). Publishers are idempotent: the BullMQ job id is
deterministic (`risk-review_<applicationId>_<submissionVersion>`), so re-publishing after a crash
is a no-op.

## Consequences

- A job exists if and only if its submit committed.
- `SKIP LOCKED` lets several worker replicas share the table without double-publishing.
- Up to about one second of extra latency, and a polling query every second.
- The same mechanism can carry other events later (e.g. projecting audit entries to another store).

## Alternatives considered

| Option                          | Why not                                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Enqueue after commit            | Loses jobs on crash; would rely entirely on the reaper                                                           |
| LISTEN/NOTIFY to wake the relay | Lower latency, but notifications are lost while disconnected, so polling is still needed; a reasonable next step |
| CDC (Debezium) from the WAL     | Robust and fast, but heavy infrastructure for this scope                                                         |
