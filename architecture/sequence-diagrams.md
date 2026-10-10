# Sequence diagrams

How each HTTP endpoint and each worker component uses the services in the codebase. Names match
the classes and methods in `src/`. Shaded boxes are database transactions; everything inside one
box commits or rolls back together.

Contents

1. [Shared HTTP request pipeline](#1-shared-http-request-pipeline)
2. [POST /auth/login](#2-post-authlogin)
3. [POST /auth/refresh and /auth/logout](#3-post-authrefresh-and-authlogout)
   - [POST /users, GET /users and PATCH /users/:id](#post-users-get-users-and-patch-usersid)
4. [POST /applications (create)](#4-post-applications-create)
5. [GET /applications and GET /applications/:id](#5-get-applications-and-get-applicationsid)
6. [PATCH /applications/:id](#6-patch-applicationsid)
7. [POST /applications/:id/assign](#7-post-applicationsidassign)
8. [POST /applications/:id/submit](#8-post-applicationsidsubmit)
9. [Worker: outbox relay](#9-worker-outbox-relay)
10. [Worker: risk review job (sync KYB)](#10-worker-risk-review-job-sync-kyb)
11. [Worker: retries exhausted, dead letter, ADMIN retry](#11-worker-retries-exhausted-dead-letter-admin-retry)
12. [Worker: reaper](#12-worker-reaper)
13. [POST /applications/:id/decision](#13-post-applicationsiddecision)
14. [Callback mode: POST /webhooks/kyb](#14-callback-mode-post-webhookskyb)
15. [Audit: write path per store, GET /audit, GET /audit/stats/decisions](#15-audit-write-path-per-store-get-audit-get-auditstatsdecisions)
16. [End to end: from submit to decision](#16-end-to-end-from-submit-to-decision)

Process map

| Process            | Entry point      | Runs                                                                                  |
| ------------------ | ---------------- | ------------------------------------------------------------------------------------- |
| API                | `dist/main.js`   | controllers, guards, services; writes outbox events; receives KYB webhooks            |
| Worker             | `dist/worker.js` | `OutboxRelay` (every 1 s), `RiskReviewProcessor` (BullMQ), `RiskReviewReaper` (5 min) |
| PostgreSQL         |                  | all business data, `outbox_events`, `audit_logs` (default store), `webhook_events`    |
| Redis              |                  | BullMQ queues `risk-review` and `risk-review-dlq`                                     |
| MongoDB (optional) |                  | `audit_logs` collection when `AUDIT_STORE=mongo`                                      |

---

## 1. Shared HTTP request pipeline

Every request below goes through these steps first. Later diagrams start at the controller.

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant MW as RequestContextMiddleware
    participant ALS as RequestContext (AsyncLocalStorage)
    participant JG as JwtAuthGuard
    participant DB as PostgreSQL
    participant RG as RolesGuard
    participant TG as ThrottlerGuard
    participant VP as ValidationPipe
    participant CT as Controller
    participant EF as HttpExceptionFilter

    C->>MW: HTTP request (optional x-request-id)
    MW->>MW: resolveRequestId(): keep a well-formed id, else randomUUID()
    MW->>ALS: run({ requestId, ip, actor: null })
    MW-->>C: response header x-request-id (set now, sent with the response)
    MW->>JG: next()
    alt route marked @Public()
        JG-->>RG: allow
    else protected route
        JG->>JG: verify Bearer JWT (HS256, issuer, audience, expiry)
        JG->>DB: SELECT id, role, is_active FROM users WHERE id = sub
        alt invalid token or user inactive
            JG-->>EF: UnauthorizedException
            EF-->>C: 401 { statusCode, error, message, requestId }
        end
        JG->>ALS: setActor({ id, role })
        JG-->>RG: request.user = { id, role }
    end
    RG->>RG: compare @Roles(...) with user.role
    alt role not allowed
        RG-->>EF: ForbiddenException
        EF-->>C: 403
    end
    RG->>TG: per-IP rate limit (stricter on /auth/login)
    TG->>VP: transform and validate params, query, body (whitelist, forbidNonWhitelisted)
    alt invalid input
        VP-->>EF: BadRequestException
        EF-->>C: 400 with details[]
    end
    VP->>CT: handler(dto, @CurrentActor())
    CT-->>C: 2xx JSON
    Note over CT,EF: Any thrown error goes to HttpExceptionFilter:<br/>DomainError kinds map to 404/403/409/422,<br/>Postgres 23505 to 409, 23502/23503/23514/22P02 to 422,<br/>anything else to a generic 500 (logged, never leaked).
```

---

## 2. POST /auth/login

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant AC as AuthController
    participant AS as AuthService
    participant DB as PostgreSQL
    participant PH as PasswordHasher (argon2id)
    participant AU as AuditService
    participant RT as RefreshTokenService
    participant JW as JwtService

    C->>AC: POST /auth/login { email, password }
    Note over AC: @Public, @Throttle (login limit)
    AC->>AS: login(email, password)
    AS->>DB: SELECT id, role, is_active, password_hash FROM users WHERE email = $1 (citext)
    alt user found
        AS->>PH: verify(hash, password)
    else unknown email
        AS->>PH: verifyAgainstDummy(password)
        Note right of PH: same CPU cost, so timing<br/>does not reveal unknown emails
    end
    alt wrong password, unknown email or inactive user
        AS->>AU: record(AUTH_LOGIN_FAILED, metadata { email })
        AU->>DB: INSERT audit_logs (email masked to j***@example.com)
        AS-->>C: 401 "Invalid email or password"
    else valid
        rect rgba(120, 160, 255, 0.12)
            AS->>AU: record(AUTH_LOGIN_SUCCEEDED, actor = user)
            AU->>DB: INSERT audit_logs
            AS->>JW: signAsync({ sub, role }, expiresIn 900 s)
            AS->>RT: issue(manager, userId)
            RT->>RT: token = randomBytes(32), familyId = new uuid
            RT->>DB: INSERT refresh_tokens (token_hash = sha256(token), expires_at)
        end
        AS-->>AC: { accessToken, refreshToken, tokenType, expiresIn }
        AC-->>C: 200
    end
```

---

## 3. POST /auth/refresh and /auth/logout

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant AC as AuthController
    participant AS as AuthService
    participant RT as RefreshTokenService
    participant DB as PostgreSQL
    participant AU as AuditService
    participant JW as JwtService

    C->>AC: POST /auth/refresh { refreshToken }
    AC->>AS: refresh(rawToken)
    rect rgba(120, 160, 255, 0.12)
        AS->>RT: rotate(manager, rawToken)
        RT->>DB: SELECT … FROM refresh_tokens WHERE token_hash = sha256(raw) FOR UPDATE
        Note right of DB: the row lock serialises<br/>concurrent refreshes of one token
        alt not found or expired
            RT-->>AS: { kind: invalid }
        else already rotated or revoked (replay)
            RT->>DB: UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = … AND revoked_at IS NULL
            RT-->>AS: { kind: reused, userId }
            AS->>AU: record(AUTH_REFRESH_REUSE_DETECTED)
            AU->>DB: INSERT audit_logs
        else valid
            RT-->>AS: { kind: rotated, userId, familyId, tokenId }
            AS->>DB: SELECT id, role, is_active FROM users
            AS->>RT: issue(manager, userId, familyId)
            RT->>DB: INSERT refresh_tokens (same family)
            AS->>RT: markRotated(tokenId, newId)
            RT->>DB: UPDATE old token SET revoked_at, replaced_by_id
            AS->>JW: signAsync({ sub, role })
        end
    end
    Note over AS,DB: on reuse the method returns instead of throwing,<br/>so the family revocation commits before the 401
    alt rotated and user active
        AS-->>C: 200 new { accessToken, refreshToken }
    else invalid, reused or inactive
        AS-->>C: 401 "Invalid refresh token"
    end

    C->>AC: POST /auth/logout { refreshToken }
    AC->>AS: logout(rawToken)
    AS->>RT: revokeFamily(manager, rawToken)
    RT->>DB: UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = …
    AS-->>C: 204
```

### POST /users, GET /users and PATCH /users/:id

ADMIN-only account management. ADMIN accounts themselves are not creatable through the API.

```mermaid
sequenceDiagram
    autonumber
    actor A as ADMIN
    participant UC as UsersController
    participant US as UsersService
    participant PH as PasswordHasher (argon2id)
    participant DB as PostgreSQL
    participant AU as AuditService

    A->>UC: POST /users { email, fullName, role SALES or REVIEWER, password }
    Note over UC: @Roles(ADMIN) on the controller, role limited to SALES/REVIEWER,<br/>password 12 to 256 chars, unknown fields rejected
    UC->>US: create(dto)
    US->>PH: hash(password)
    Note right of PH: outside the transaction (slow by design)
    rect rgba(120, 160, 255, 0.12)
        US->>DB: EXISTS users WHERE email = $1 (citext, case-insensitive)
        alt already exists
            US-->>A: 409
        end
        US->>DB: INSERT users (password_hash, role, is_active true)
        Note right of DB: a concurrent duplicate fails on the unique index,<br/>23505 maps to 409
        US->>AU: record(USER_CREATED, { email, role })
        AU->>DB: INSERT audit_logs (email masked, no password)
    end
    UC-->>A: 201 { id, email, fullName, role, isActive, createdAt }

    A->>UC: GET /users?role=REVIEWER&page=&pageSize=
    UC->>US: list(query)
    US->>DB: SELECT … WHERE role = ? ORDER BY created_at DESC, id DESC LIMIT/OFFSET, plus COUNT
    UC-->>A: 200 { items (no password hashes), total, page, pageSize }

    A->>UC: PATCH /users/:id { isActive }
    Note over UC: ParseUUIDPipe, isActive must be boolean, nothing else allowed
    UC->>US: setActive(id, isActive)
    rect rgba(120, 160, 255, 0.12)
        US->>DB: SELECT users WHERE id FOR UPDATE
        alt not found
            US-->>A: 404
        else role ADMIN (including the caller)
            US-->>A: 403
        else already in that state
            US-->>A: 200 unchanged, no audit entry
        end
        US->>DB: UPDATE users SET is_active
        opt deactivating
            US->>DB: UPDATE refresh_tokens SET revoked_at = now() WHERE user_id AND revoked_at IS NULL
        end
        US->>AU: record(USER_DEACTIVATED or USER_REACTIVATED, { role })
        AU->>DB: INSERT audit_logs
    end
    UC-->>A: 200 UserResponse
    Note over A,DB: the user's next request fails in JwtAuthGuard (reloads is_active),<br/>refresh and login return 401 until reactivated
```

---

## 4. POST /applications (create)

```mermaid
sequenceDiagram
    autonumber
    actor S as SALES or ADMIN
    participant CT as ApplicationsController
    participant SV as ApplicationsService
    participant PO as application.policy (CASL)
    participant FE as FieldEncryptionService
    participant DB as PostgreSQL
    participant AU as AuditService
    participant RM as toApplicationResponse

    S->>CT: POST /applications CreateApplicationDto
    Note over CT: @Roles(SALES, ADMIN), DTO validated (E.164 phone,<br/>MCC 4 digits, ISO currency, integer cents)
    CT->>SV: create(actor, dto)
    SV->>PO: can(actor, 'create')
    alt not allowed
        SV-->>S: 403
    end
    SV->>SV: assertBusinessRules: averageTicket <= monthlyVolume,<br/>taxIdType and taxId together
    alt rule broken
        SV-->>S: 422
    end
    opt taxId present
        SV->>FE: encrypt(taxId, 'merchant_applications.tax_id')
        FE-->>SV: v1.keyId.iv.tag.ciphertext (AES-256-GCM, AAD bound to the column)
    end
    rect rgba(120, 160, 255, 0.12)
        SV->>DB: INSERT merchant_applications (status DRAFT, created_by_id = actor, tax_id_last4)
        SV->>AU: record(APPLICATION_CREATED, metadata { businessName, ownerEmail, ownerPhone })
        AU->>AU: redact(): mask email and phone, drop secrets
        AU->>DB: INSERT audit_logs (actor and request id from RequestContext)
    end
    SV->>DB: SELECT the saved row
    SV-->>CT: MerchantApplication
    CT->>RM: allow-list mapping (no ciphertext, taxIdLast4 only)
    CT-->>S: 201 ApplicationResponse
```

---

## 5. GET /applications and GET /applications/:id

```mermaid
sequenceDiagram
    autonumber
    actor U as Any role
    participant CT as ApplicationsController
    participant SV as ApplicationsService
    participant PO as applicationScope()
    participant DB as PostgreSQL

    U->>CT: GET /applications?status=&page=&pageSize=
    CT->>SV: list(actor, query)
    SV->>PO: applicationScope(actor)
    PO-->>SV: SALES { createdById: me }<br/>REVIEWER { assignedReviewerId: me }<br/>ADMIN {}
    SV->>DB: SELECT … WHERE scope filter AND status = ? ORDER BY created_at DESC, id DESC LIMIT/OFFSET, plus COUNT
    SV-->>CT: { items, total, page, pageSize }
    CT-->>U: 200 (each item through toApplicationResponse)

    U->>CT: GET /applications/:id
    Note over CT: ParseUUIDPipe: malformed id gives 400
    CT->>SV: get(actor, id)
    SV->>PO: applicationScope(actor)
    SV->>DB: SELECT … WHERE id = $1 AND scope filter
    alt no row (missing or not visible to this actor)
        SV-->>U: 404 "Application not found"
    else
        SV-->>U: 200 ApplicationResponse
    end
```

---

## 6. PATCH /applications/:id

```mermaid
sequenceDiagram
    autonumber
    actor S as SALES (owner) or ADMIN
    participant CT as ApplicationsController
    participant SV as ApplicationsService
    participant PO as application.policy
    participant SM as application-state-machine
    participant FE as FieldEncryptionService
    participant DB as PostgreSQL
    participant AU as AuditService

    S->>CT: PATCH /applications/:id { …changes, version }
    Note over CT: UpdateApplicationDto: partial, null rejected,<br/>version required
    CT->>SV: update(actor, id, dto)
    rect rgba(120, 160, 255, 0.12)
        SV->>DB: SELECT … WHERE id AND scope filter FOR UPDATE
        alt not visible
            SV-->>S: 404
        end
        SV->>PO: can(actor, 'update', application)
        alt visible but not permitted
            SV-->>S: 403
        end
        SV->>SM: isEditable(status)
        alt not DRAFT or INFO_REQUESTED
            SV-->>S: 409
        end
        alt dto.version != row.version
            SV-->>S: 409 "modified by someone else"
        end
        SV->>SV: assertBusinessRules on merged values (422 on failure)
        opt new taxId
            SV->>FE: encrypt(taxId, context)
        end
        SV->>DB: UPDATE merchant_applications SET …, version = version + 1
        SV->>AU: record(APPLICATION_UPDATED, metadata { changedFields })
        AU->>DB: INSERT audit_logs
    end
    SV-->>S: 200 ApplicationResponse (version bumped)
```

---

## 7. POST /applications/:id/assign

```mermaid
sequenceDiagram
    autonumber
    actor A as ADMIN
    participant CT as ApplicationsController
    participant WF as ApplicationWorkflowService
    participant SV as ApplicationsService
    participant SM as application-state-machine
    participant DB as PostgreSQL
    participant AU as AuditService

    A->>CT: POST /applications/:id/assign { reviewerId }
    Note over CT: @Roles(ADMIN), reviewerId must be a UUID
    CT->>WF: assignReviewer(actor, id, reviewerId)
    rect rgba(120, 160, 255, 0.12)
        WF->>SV: findVisibleOrFail(manager, actor, id, lock)
        SV->>DB: SELECT … FOR UPDATE
        WF->>SV: assertCan(actor, 'assign')
        WF->>SM: isAssignable(status)
        alt DRAFT, APPROVED or REJECTED
            WF-->>A: 409
        end
        WF->>DB: SELECT user WHERE id = reviewerId AND role = REVIEWER AND is_active
        alt not an active reviewer
            WF-->>A: 422
        end
        WF->>DB: UPDATE merchant_applications SET assigned_reviewer_id
        WF->>AU: record(APPLICATION_REVIEWER_ASSIGNED, { reviewerId, previousReviewerId })
        AU->>DB: INSERT audit_logs
    end
    WF-->>A: 200 ApplicationResponse
```

---

## 8. POST /applications/:id/submit

The API never talks to Redis here: the job is recorded in Postgres, in the same transaction as the
status change, and the worker publishes it (diagram 9).

```mermaid
sequenceDiagram
    autonumber
    actor S as SALES (owner) or ADMIN
    participant CT as ApplicationsController
    participant WF as ApplicationWorkflowService
    participant SV as ApplicationsService
    participant SM as application-state-machine
    participant OB as OutboxService
    participant ALS as RequestContext
    participant DB as PostgreSQL
    participant AU as AuditService

    S->>CT: POST /applications/:id/submit
    CT->>WF: submit(actor, id)
    rect rgba(120, 160, 255, 0.12)
        WF->>SV: findVisibleOrFail(manager, actor, id, lock)
        SV->>DB: SELECT … FOR UPDATE
        Note right of DB: a concurrent submit waits here,<br/>then sees SUBMITTED and gets 409
        WF->>SV: assertCan(actor, 'submit')
        WF->>SM: nextStatus(status, SUBMIT)
        alt not DRAFT or INFO_REQUESTED
            SM-->>S: 409 InvalidStateError
        end
        alt no tax id on file
            WF-->>S: 422
        end
        WF->>DB: UPDATE status SUBMITTED, risk_status PENDING,<br/>submission_version + 1, submitted_at
        WF->>OB: enqueue(manager, RiskReviewRequested { applicationId, submissionVersion })
        OB->>ALS: get().requestId
        OB->>DB: INSERT outbox_events (correlation_id = request id)
        WF->>AU: record(APPLICATION_SUBMITTED, { submissionVersion })
        AU->>DB: INSERT audit_logs
    end
    WF-->>S: 200 { status SUBMITTED, riskStatus PENDING, submissionVersion }
```

---

## 9. Worker: outbox relay

```mermaid
sequenceDiagram
    autonumber
    participant SCH as ScheduleModule (@Interval 1 s)
    participant RL as OutboxRelay
    participant DB as PostgreSQL
    participant REG as OutboxPublisherRegistry
    participant PUB as RiskReviewPublisher
    participant MP as MongoAuditProjector (mongo mode)
    participant Q as Redis queue risk-review

    SCH->>RL: tick()
    alt previous tick still running
        RL-->>SCH: skip
    end
    rect rgba(120, 160, 255, 0.12)
        RL->>DB: SELECT … FROM outbox_events WHERE processed_at IS NULL AND available_at <= now()<br/>ORDER BY available_at LIMIT 50 FOR UPDATE SKIP LOCKED
        Note right of DB: SKIP LOCKED lets several worker<br/>replicas share the table
        loop each event, in order
            RL->>REG: get(eventType)
            alt RiskReviewRequested
                REG->>PUB: enqueue(event)
                PUB->>Q: add('review', { applicationId, submissionVersion, correlationId },<br/>jobId risk-review_appId_version)
                Note right of Q: an existing jobId is ignored,<br/>so re-publishing is harmless
            else RiskReviewRetryRequested
                REG->>PUB: retry(event)
                PUB->>Q: getJob(jobId)
                alt job exists and failed
                    PUB->>Q: job.retry('failed', reset attempts)
                else job missing
                    PUB->>Q: add(…) as above
                end
            else AuditRecorded (AUDIT_STORE=mongo)
                REG->>MP: project(event), see diagram 15
            end
            alt handler succeeded
                RL->>DB: UPDATE outbox_events SET processed_at = now()
            else handler failed or no handler
                RL->>DB: UPDATE attempts + 1, last_error,<br/>available_at = now() + min(2^(attempts-1) s, 5 min)
            end
        end
    end
```

---

## 10. Worker: risk review job (sync KYB)

```mermaid
sequenceDiagram
    autonumber
    participant Q as Redis queue risk-review
    participant PR as RiskReviewProcessor (WorkerHost, concurrency 5)
    participant ALS as RequestContext
    participant UC as ProcessRiskReviewUseCase
    participant DB as PostgreSQL
    participant KYB as KybProvider (FakeKybProvider)
    participant SC as scoreApplication()
    participant CP as RiskAssessmentCompleter
    participant SM as application-state-machine
    participant AU as AuditService

    Q->>PR: process(job)
    PR->>ALS: run({ requestId: job.data.correlationId, actor: null })
    PR->>UC: execute({ applicationId, submissionVersion, correlationId })
    rect rgba(120, 160, 255, 0.12)
        Note over UC,DB: transaction 1: claim the work
        UC->>DB: SELECT merchant_applications … FOR UPDATE
        alt missing, or job is for an older submission
            UC-->>PR: 'stale' (job completes, nothing changes)
        end
        UC->>DB: INSERT risk_assessments (application_id, submission_version) ON CONFLICT DO NOTHING
        UC->>DB: SELECT the assessment
        alt assessment already COMPLETED
            UC-->>PR: 'already-completed'
        else application no longer SUBMITTED
            UC-->>PR: 'stale'
        end
        UC->>DB: UPDATE risk_assessments SET attempts = attempts + 1
    end
    Note over UC,KYB: no transaction or lock held during network I/O
    UC->>KYB: verify({ applicationId, legalBusinessName })
    alt transient failure (KybUnavailableError)
        UC->>DB: UPDATE risk_assessments SET last_error
        UC-->>PR: throw
        PR-->>Q: job failed, BullMQ retries with exponential backoff (diagram 11)
    end
    KYB-->>UC: { reference, businessVerified, watchlistHit }
    rect rgba(120, 160, 255, 0.12)
        Note over UC,AU: transaction 2: re-check, then write the result
        UC->>DB: SELECT merchant_applications … FOR UPDATE (same stale check)
        UC->>DB: SELECT assessment, skip if COMPLETED meanwhile
        UC->>CP: complete(manager, { application, assessmentId, kyb, correlationId })
        CP->>SC: scoreApplication(application, kyb)
        SC-->>CP: { score, level, reasons }
        CP->>DB: UPDATE risk_assessments SET COMPLETED, score, level,<br/>provider_reference, response (redacted), completed_at
        CP->>SM: nextStatus(SUBMITTED, RISK_COMPLETED)
        CP->>DB: UPDATE merchant_applications SET status UNDER_REVIEW, risk_status COMPLETED
        CP->>AU: record(RISK_REVIEW_COMPLETED, actor null, correlationId)
        AU->>DB: INSERT audit_logs (request_id = the submit request's id)
    end
    UC-->>PR: 'completed'
    PR-->>Q: job completed
```

---

## 11. Worker: retries exhausted, dead letter, ADMIN retry

```mermaid
sequenceDiagram
    autonumber
    participant Q as Redis queue risk-review
    participant PR as RiskReviewProcessor
    participant MF as MarkRiskReviewFailedUseCase
    participant DB as PostgreSQL
    participant AU as AuditService
    participant DLQ as Redis queue risk-review-dlq
    actor A as ADMIN
    participant CT as ApplicationsController
    participant WF as ApplicationWorkflowService
    participant OB as OutboxService

    loop attempts 1..RISK_JOB_ATTEMPTS (default 5)
        Q->>PR: process(job), see diagram 10
        PR-->>Q: throws, backoff RISK_JOB_BACKOFF_MS x 2^n
    end
    Q->>PR: @OnWorkerEvent('failed') onFailed(job, error)
    alt attemptsMade < attempts
        PR-->>Q: ignore, BullMQ will retry
    else retries exhausted
        PR->>MF: execute(job.data, error.message)
        rect rgba(120, 160, 255, 0.12)
            MF->>DB: SELECT merchant_applications … FOR UPDATE
            alt stale submission or risk_status not PENDING
                MF-->>PR: no-op (idempotent)
            end
            MF->>DB: UPDATE risk_assessments SET FAILED, last_error
            MF->>DB: UPDATE merchant_applications SET risk_status FAILED
            MF->>AU: record(RISK_REVIEW_FAILED, actor null)
            AU->>DB: INSERT audit_logs
        end
        PR->>DLQ: add('dead-letter', { …data, error, failedAt }, jobId)
        Note over PR,DLQ: if this handler crashes, the reaper<br/>reconciles it later (diagram 12)
    end

    A->>CT: POST /applications/:id/risk-review/retry
    Note over CT: @Roles(ADMIN)
    CT->>WF: retryRisk(actor, id)
    rect rgba(120, 160, 255, 0.12)
        WF->>DB: SELECT … FOR UPDATE (scoped)
        WF->>WF: assertCan(actor, 'retryRisk')
        alt risk_status != FAILED
            WF-->>A: 409
        end
        WF->>DB: UPDATE merchant_applications SET risk_status PENDING
        WF->>DB: UPDATE risk_assessments SET PENDING, last_error null
        WF->>OB: enqueue(RiskReviewRetryRequested { applicationId, submissionVersion })
        OB->>DB: INSERT outbox_events
        WF->>AU: record(RISK_REVIEW_RETRIED)
        AU->>DB: INSERT audit_logs
    end
    WF-->>A: 202
    Note over A,OB: the relay (diagram 9) calls job.retry() on the failed job,<br/>then the processor runs it again (diagram 10)
```

---

## 12. Worker: reaper

```mermaid
sequenceDiagram
    autonumber
    participant SCH as ScheduleModule (@Cron every 5 min)
    participant RP as RiskReviewReaper
    participant DB as PostgreSQL
    participant Q as Redis queue risk-review
    participant OB as OutboxService
    participant MF as MarkRiskReviewFailedUseCase

    SCH->>RP: tick() then reap(15 min)
    RP->>DB: SELECT applications WHERE status SUBMITTED AND risk_status PENDING<br/>AND submitted_at < now() - 15 min LIMIT 100
    loop each stuck application
        RP->>Q: getJob(risk-review_appId_version)
        alt no job in Redis
            RP->>DB: EXISTS outbox_events WHERE aggregate_id AND processed_at IS NULL
            alt an event is still waiting
                RP-->>RP: skip, the relay will publish it
            else nothing waiting (job lost)
                RP->>OB: enqueue(RiskReviewRequested)
                OB->>DB: INSERT outbox_events
            end
        else job failed and attempts exhausted
            RP->>MF: execute(data, job.failedReason)
            Note right of MF: same idempotent use case as diagram 11
        else job waiting or active
            RP-->>RP: leave it
        end
    end
    RP->>DB: SELECT risk_assessments WHERE status AWAITING_CALLBACK<br/>AND updated_at < now() - KYB_CALLBACK_TIMEOUT_MS
    loop each overdue callback (callback mode)
        RP->>MF: execute(data, 'KYB callback not received before timeout')
    end
```

---

## 13. POST /applications/:id/decision

```mermaid
sequenceDiagram
    autonumber
    actor R as REVIEWER
    participant CT as ApplicationsController
    participant WF as ApplicationWorkflowService
    participant SV as ApplicationsService
    participant PO as application.policy
    participant SM as application-state-machine
    participant DB as PostgreSQL
    participant AU as AuditService

    R->>CT: POST /applications/:id/decision { decision, reason? }
    Note over CT: no @Roles: visibility and policy decide
    CT->>WF: decide(actor, id, dto)
    alt REJECT or REQUEST_INFO with reason shorter than 10 chars
        WF-->>R: 422
    end
    rect rgba(120, 160, 255, 0.12)
        WF->>SV: findVisibleOrFail(manager, actor, id, lock)
        SV->>DB: SELECT … WHERE id AND scope filter FOR UPDATE
        alt reviewer not assigned (outside scope)
            SV-->>R: 404
        end
        WF->>PO: can(actor, 'decide', application)
        alt ADMIN or owning SALES (visible, not permitted)
            PO-->>R: 403
        end
        WF->>SM: nextStatus(status, APPROVE | REJECT | REQUEST_INFO)
        alt not UNDER_REVIEW (risk pending, or already decided)
            SM-->>R: 409
        end
        WF->>DB: INSERT review_decisions (reviewer_id, decision, reason)
        WF->>DB: UPDATE merchant_applications SET status, decided_at (APPROVED/REJECTED only)
        WF->>AU: record(APPLICATION_DECISION_RECORDED, { decision, from, to })
        AU->>DB: INSERT audit_logs
    end
    Note over WF,DB: a concurrent second decision waits on the row lock,<br/>then sees the new status and gets 409
    WF-->>R: 200 ApplicationResponse
```

---

## 14. Callback mode: POST /webhooks/kyb

With `KYB_MODE=callback` the worker only requests verification. The provider (here the simulated
`FakeKybProvider`) later calls the API.

```mermaid
sequenceDiagram
    autonumber
    participant UC as ProcessRiskReviewUseCase (worker)
    participant KYB as CallbackKybProvider (FakeKybProvider)
    participant DB as PostgreSQL
    participant P as Provider (simulated callback)
    participant G as KybSignatureGuard
    participant WC as KybWebhookController
    participant WS as KybWebhookService
    participant CP as RiskAssessmentCompleter
    participant AU as AuditService

    Note over UC,DB: transaction 1 as in diagram 10,<br/>an assessment already AWAITING_CALLBACK returns early (no second request)
    UC->>KYB: requestVerification({ applicationId, legalBusinessName })
    KYB-->>UC: { reference: kyb_uuid }
    KYB--)P: schedule the callback (setTimeout)
    rect rgba(120, 160, 255, 0.12)
        UC->>DB: SELECT application FOR UPDATE (stale check)
        UC->>DB: UPDATE risk_assessments SET AWAITING_CALLBACK, provider_reference
    end
    UC-->>UC: 'awaiting-callback' (job completes)

    P->>G: POST /webhooks/kyb, raw JSON body,<br/>X-Kyb-Signature t=unix,v1=HMAC-SHA256(t.rawBody)
    Note over G: @Public (no JWT), @SkipThrottle,<br/>runs before body validation
    G->>G: verifyWebhookSignature(header, rawBody, KYB_WEBHOOK_SECRETS, 300 s)
    alt missing, malformed, expired or mismatched
        G-->>P: 401, nothing stored
    end
    G->>WC: ValidationPipe then KybWebhookDto
    WC->>WS: handle(event)
    rect rgba(120, 160, 255, 0.12)
        WS->>DB: SELECT risk_assessments WHERE provider_reference AND status AWAITING_CALLBACK
        alt not found (unknown or already completed)
            WS-->>WS: outcome 'ignored'
        else found
            WS->>DB: SELECT merchant_applications … FOR UPDATE
            alt submission superseded or status no longer SUBMITTED
                WS-->>WS: outcome 'ignored'
            else current
                WS->>DB: re-read the assessment under the lock
                WS->>CP: complete(manager, { application, assessmentId, kyb from event })
                CP->>DB: UPDATE assessment COMPLETED, application UNDER_REVIEW
                CP->>AU: record(RISK_REVIEW_COMPLETED)
                AU->>DB: INSERT audit_logs
                WS-->>WS: outcome 'processed'
            end
        end
        WS->>DB: INSERT webhook_events (provider, event_id, outcome)<br/>ON CONFLICT (provider, event_id) DO NOTHING RETURNING id
        alt no row returned (another delivery recorded it first)
            WS-->>WS: throw DuplicateWebhook, roll back everything above
        end
    end
    WS-->>P: 200 { status: processed | ignored | duplicate }
```

---

## 15. Audit: write path per store, GET /audit, GET /audit/stats/decisions

`AuditService` is the only entry point for writing; the configured adapter decides where the entry
goes. `AUDIT_STORE` is read when modules are defined.

```mermaid
sequenceDiagram
    autonumber
    participant SV as Any service (inside its transaction)
    participant AS as AuditService
    participant ALS as RequestContext
    participant RD as redact()
    participant PW as PostgresAuditWriter
    participant OW as OutboxAuditWriter
    participant DB as PostgreSQL
    participant RL as OutboxRelay (worker)
    participant MP as MongoAuditProjector
    participant M as MongoDB audit_logs

    SV->>AS: record(manager, { action, entityType, entityId, metadata, actor? })
    AS->>ALS: get(): actor, requestId, ip
    AS->>RD: redact(metadata)
    alt AUDIT_STORE=postgres (default)
        AS->>PW: write(manager, record)
        PW->>DB: INSERT audit_logs (same transaction, append-only trigger)
    else AUDIT_STORE=mongo
        AS->>OW: write(manager, record)
        OW->>DB: INSERT outbox_events AuditRecorded (same transaction)
        Note over OW,DB: committed iff the action commits
        RL->>DB: SELECT … FOR UPDATE SKIP LOCKED (diagram 9)
        RL->>MP: project(event)
        MP->>M: insertOne({ _id: outbox event id, …record })
        alt E11000 duplicate _id (re-relayed)
            MP-->>RL: treat as already projected
        end
        Note over M: app user audit_app may only find and insert (mongod --auth)
    end
```

```mermaid
sequenceDiagram
    autonumber
    actor A as ADMIN
    participant AC as AuditController
    participant RD as AuditReader (Postgres or Mongo adapter)
    participant DB as PostgreSQL
    participant M as MongoDB

    A->>AC: GET /audit?entityType=&entityId=&action=&page=&pageSize=
    Note over AC: @Roles(ADMIN)
    AC->>RD: find(query)
    alt postgres
        RD->>DB: SELECT … FROM audit_logs WHERE … ORDER BY created_at DESC, id DESC, plus COUNT
    else mongo
        RD->>M: find(filter).sort({ createdAt: -1, _id: -1 }).skip().limit(), plus countDocuments
    end
    RD-->>A: 200 { items, total, page, pageSize }

    A->>AC: GET /audit/stats/decisions?from=YYYY-MM-DD&to=YYYY-MM-DD
    AC->>AC: 1 to 366 days and from < to, else 422
    AC->>RD: decisionStats({ from, to })
    alt postgres
        RD->>DB: GROUP BY day (UTC), actor_id with count(*) FILTER (WHERE decision = …)
    else mongo
        RD->>M: aggregate $match, $group { day: $dateToString UTC, reviewerId }, $project, $sort
    end
    RD-->>A: 200 [{ day, reviewerId, approved, rejected, infoRequested, total }]
```

---

## 16. End to end: from submit to decision

The whole happy path across both processes, condensed.

```mermaid
sequenceDiagram
    autonumber
    actor S as SALES
    actor AD as ADMIN
    actor R as REVIEWER
    participant API as API process
    participant DB as PostgreSQL
    participant W as Worker process
    participant Q as Redis (BullMQ)
    participant K as KYB provider

    S->>API: POST /applications (DRAFT)
    API->>DB: application + audit (one transaction)
    S->>API: POST /applications/:id/submit
    API->>DB: SUBMITTED + outbox_events + audit (one transaction)
    API-->>S: 200 SUBMITTED, risk PENDING

    W->>DB: OutboxRelay polls (SKIP LOCKED)
    W->>Q: add job risk-review_appId_1
    W->>DB: mark outbox event processed
    Q->>W: RiskReviewProcessor receives the job
    W->>DB: tx 1: lock, create assessment, attempts + 1
    W->>K: verify()
    K-->>W: result
    W->>DB: tx 2: assessment COMPLETED, application UNDER_REVIEW, audit

    AD->>API: POST /applications/:id/assign { reviewerId }
    API->>DB: assigned_reviewer_id + audit
    R->>API: GET /applications/:id (now visible to the reviewer)
    R->>API: POST /applications/:id/decision { APPROVE }
    API->>DB: review_decisions + APPROVED + decided_at + audit
    API-->>R: 200 APPROVED
```
