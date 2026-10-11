# Entity relationship diagram

PostgreSQL schema after all migrations (`src/core/database/migrations/`). Solid lines are foreign
keys; dotted lines are logical references deliberately **without** a foreign key (reasons below).
Types are Postgres types; `enum:` names a Postgres enum type listed further down.

```mermaid
erDiagram
    users ||--o{ merchant_applications : "creates (created_by_id)"
    users |o--o{ merchant_applications : "is assigned (assigned_reviewer_id)"
    users ||--o{ review_decisions : "records (reviewer_id)"
    users ||--o{ refresh_tokens : "owns (user_id, ON DELETE CASCADE)"
    merchant_applications ||--o{ review_decisions : "receives (application_id)"
    merchant_applications ||--o{ risk_assessments : "is assessed, one per submission"
    users |o..o{ audit_logs : "actor_id (no FK)"
    merchant_applications |o..o{ outbox_events : "aggregate_id (no FK)"
    refresh_tokens |o..o| refresh_tokens : "replaced_by_id (no FK)"

    users {
        uuid id PK "gen_random_uuid()"
        citext email UK "case-insensitive"
        text password_hash "argon2id, never selected by default"
        varchar full_name "200"
        enum_user_role role
        boolean is_active "default true"
        timestamptz created_at
        timestamptz updated_at
    }

    merchant_applications {
        uuid id PK
        varchar business_name "200"
        varchar legal_business_name "200"
        enum_business_type business_type
        varchar owner_full_name "200"
        varchar owner_email "320, masked in audit"
        varchar owner_phone "32, E.164, masked in audit"
        char mcc "4, nullable, ISO 18245"
        bigint expected_monthly_volume_cents "> 0"
        bigint average_ticket_cents "> 0 and <= volume"
        char currency "3, ISO 4217"
        enum_tax_id_type tax_id_type "nullable"
        text tax_id_encrypted "AES-256-GCM, nullable"
        varchar tax_id_last4 "4, nullable"
        enum_application_status status "default DRAFT"
        enum_risk_status risk_status "default NOT_STARTED"
        uuid created_by_id FK "users, RESTRICT"
        uuid assigned_reviewer_id FK "users, RESTRICT, nullable"
        int submission_version "default 0, +1 per submit"
        int version "optimistic locking"
        timestamptz submitted_at "nullable"
        timestamptz decided_at "nullable"
        timestamptz created_at
        timestamptz updated_at
    }

    review_decisions {
        uuid id PK
        uuid application_id FK "merchant_applications, RESTRICT"
        uuid reviewer_id FK "users, RESTRICT"
        enum_review_decision decision
        text reason "required for REJECT and REQUEST_INFO"
        timestamptz created_at
    }

    risk_assessments {
        uuid id PK
        uuid application_id FK "merchant_applications, RESTRICT"
        int submission_version "UK with application_id"
        enum_risk_assessment_status status "default PENDING"
        smallint score "0..100, nullable"
        enum_risk_level level "nullable"
        varchar provider_reference "100, indexed, nullable"
        jsonb response "redacted provider payload"
        int attempts "default 0"
        text last_error "nullable"
        timestamptz completed_at "nullable"
        timestamptz created_at
        timestamptz updated_at
    }

    refresh_tokens {
        uuid id PK
        uuid user_id FK "users, CASCADE"
        uuid family_id "rotation chain"
        char token_hash UK "64, SHA-256 hex"
        timestamptz expires_at
        timestamptz revoked_at "nullable"
        uuid replaced_by_id "nullable, next token in family"
        timestamptz created_at
    }

    audit_logs {
        bigint id PK "identity, always generated"
        uuid actor_id "nullable = system actor"
        enum_user_role actor_role "nullable"
        varchar action "64"
        varchar entity_type "64"
        varchar entity_id "64, nullable"
        jsonb metadata "redacted, default {}"
        varchar request_id "64, correlation id"
        inet ip "nullable"
        timestamptz created_at
    }

    outbox_events {
        uuid id PK
        varchar aggregate_type "64"
        uuid aggregate_id
        varchar event_type "100"
        jsonb payload
        varchar correlation_id "64, nullable"
        timestamptz available_at "relay backoff"
        int attempts "default 0"
        text last_error "nullable"
        timestamptz processed_at "nullable = pending"
        timestamptz created_at
    }

    webhook_events {
        uuid id PK
        varchar provider "32, UK with event_id"
        varchar event_id "128"
        varchar event_type "64"
        jsonb payload "provider data, no PII"
        varchar outcome "processed or ignored"
        timestamptz received_at
    }
```

## Relationships

| From                                         | To                         | Cardinality      | On delete | Meaning                                                               |
| -------------------------------------------- | -------------------------- | ---------------- | --------- | --------------------------------------------------------------------- |
| `merchant_applications.created_by_id`        | `users.id`                 | many to one      | RESTRICT  | the SALES (or ADMIN) user who owns the application                    |
| `merchant_applications.assigned_reviewer_id` | `users.id`                 | many to zero/one | RESTRICT  | the only REVIEWER allowed to decide                                   |
| `review_decisions.application_id`            | `merchant_applications.id` | many to one      | RESTRICT  | decision history (the application holds current status)               |
| `review_decisions.reviewer_id`               | `users.id`                 | many to one      | RESTRICT  | who decided                                                           |
| `risk_assessments.application_id`            | `merchant_applications.id` | many to one      | RESTRICT  | one row per submission, unique `(application_id, submission_version)` |
| `refresh_tokens.user_id`                     | `users.id`                 | many to one      | CASCADE   | sessions die with the user                                            |

Users and applications are never hard-deleted (RESTRICT everywhere they are referenced); users are
deactivated instead, which keeps decision and audit history intact.

### References without a foreign key (on purpose)

| Column                                | Points at                                  | Why no FK                                                                                        |
| ------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `audit_logs.actor_id`                 | `users.id`                                 | audit history must outlive the rows it describes; NULL means a system actor (worker)             |
| `audit_logs.entity_id`                | any entity (by `entity_type`)              | polymorphic: applications, users, …                                                              |
| `outbox_events.aggregate_id`          | usually `merchant_applications.id`         | the outbox is generic infrastructure for any aggregate; events are processed, then kept as a log |
| `refresh_tokens.replaced_by_id`       | the next `refresh_tokens.id` in the family | informational link in the rotation chain; reuse detection works on `family_id`                   |
| `risk_assessments.provider_reference` | the KYB provider's id                      | external system; indexed for webhook lookups                                                     |

## Keys, constraints and indexes

| Table                   | Unique / check constraints                                                                                                                                                                                                | Indexes (besides PK and unique)                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                 | `uq_users_email` (citext)                                                                                                                                                                                                 |                                                                                                                                        |
| `merchant_applications` | `chk_…_volume_positive`, `chk_…_ticket_positive`, `chk_…_ticket_le_volume`, `chk_…_mcc_format` (`^[0-9]{4}$`), `chk_…_currency_format` (`^[A-Z]{3}$`), `chk_…_tax_id_complete` (all three tax id columns set or all null) | `(created_by_id, status, created_at)` SALES list · `(assigned_reviewer_id, status)` reviewer queue · `(status, created_at)` ADMIN list |
| `review_decisions`      |                                                                                                                                                                                                                           | `(application_id, created_at)`                                                                                                         |
| `risk_assessments`      | `uq_…_application_id_submission_version` (idempotency) · `chk_…_score_range` (0..100)                                                                                                                                     | `(provider_reference)` webhook lookup                                                                                                  |
| `refresh_tokens`        | `uq_refresh_tokens_token_hash`                                                                                                                                                                                            | `(user_id)` · `(family_id)` family revocation                                                                                          |
| `audit_logs`            | append-only: triggers block UPDATE, DELETE and TRUNCATE                                                                                                                                                                   | `(entity_type, entity_id, created_at)` · `(actor_id, created_at)`                                                                      |
| `outbox_events`         |                                                                                                                                                                                                                           | `(available_at) WHERE processed_at IS NULL` (partial, relay polling)                                                                   |
| `webhook_events`        | `uq_webhook_events_provider_event_id` (idempotency)                                                                                                                                                                       |                                                                                                                                        |

Leading index columns also cover the foreign key lookups on `merchant_applications`.

## Enum types

| Postgres type            | Values                                                             | Used by                                                 |
| ------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------- |
| `user_role`              | ADMIN, REVIEWER, SALES                                             | `users.role`, `audit_logs.actor_role`                   |
| `business_type`          | SOLE_PROPRIETOR, PARTNERSHIP, LLC, CORPORATION, NON_PROFIT         | `merchant_applications.business_type`                   |
| `application_status`     | DRAFT, SUBMITTED, UNDER_REVIEW, INFO_REQUESTED, APPROVED, REJECTED | `merchant_applications.status`                          |
| `risk_status`            | NOT_STARTED, PENDING, COMPLETED, FAILED                            | `merchant_applications.risk_status` (latest submission) |
| `tax_id_type`            | PAN, VAT, EIN, GSTIN, OTHER                                        | `merchant_applications.tax_id_type`                     |
| `review_decision`        | APPROVE, REJECT, REQUEST_INFO                                      | `review_decisions.decision`                             |
| `risk_assessment_status` | PENDING, COMPLETED, FAILED, AWAITING_CALLBACK                      | `risk_assessments.status`                               |
| `risk_level`             | LOW, MEDIUM, HIGH                                                  | `risk_assessments.level`                                |

## Optional MongoDB audit store

With `AUDIT_STORE=mongo`, audit entries are projected from `outbox_events` (event type
`AuditRecorded`) into a MongoDB collection instead of the Postgres `audit_logs` table.

```mermaid
erDiagram
    outbox_events ||..o| mongo_audit_logs : "AuditRecorded event projected once (_id = outbox_events.id)"

    mongo_audit_logs {
        string _id PK "outbox event id (idempotent projection)"
        string actorId "nullable"
        string actorRole "nullable"
        string action
        string entityType
        string entityId "nullable"
        object metadata "redacted"
        string requestId "nullable"
        string ip "nullable"
        date createdAt
    }
```

Indexes `{ entityType, entityId, createdAt: -1 }`, `{ actorId, createdAt: -1 }`,
`{ action, createdAt: -1 }`, created by `infra/mongo/init/01-audit.js`. The application user may
only `find` and `insert` (server runs with `--auth`).
