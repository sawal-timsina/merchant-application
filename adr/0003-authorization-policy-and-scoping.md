# ADR 0003: Authorization with a CASL policy and an equivalent SQL scope

- Status: accepted
- Date: 2026-10-10

## Context

Rules: SALES see and edit only applications they created; only the assigned REVIEWER may record
a decision; ADMIN has operational access. A SALES user must not be able to read or change
another user's application by id, and list endpoints must never leak rows.

## Decision

Three layers:

1. **Authentication**: a global JWT guard. Routes are private unless marked `@Public()`. The
   user is reloaded per request, so deactivation and role changes apply immediately.
2. **Role gate**: `@Roles(...)` with a global `RolesGuard` for coarse checks (e.g. only ADMIN can
   assign).
3. **Object level**: `domain/application.policy.ts` defines a CASL ability per actor (_who_ may
   do _what_ to _which_ application) and `applicationScope(actor)`, the SQL equivalent of the
   read rule (`created_by_id = me` for SALES, `assigned_reviewer_id = me` for REVIEWER, nothing
   for ADMIN). Services load rows through the scope, so lists and lookups are filtered in the
   database. A unit test checks, across actors and rows, that the scope matches the ability.

Responses: a row outside the caller's scope is **404**, so existence is not revealed. A visible
row the caller may not act on (SALES deciding their own application, ADMIN deciding at all) is
**403**. Whether an action is allowed _now_ (status) belongs to the state machine, not the policy.

ADMIN cannot record decisions: the rule says "only the assigned REVIEWER", and separating
assignment from decision avoids one person controlling both.

## Consequences

- Authorization is testable as pure functions; integration tests prove it can't be bypassed by id.
- Two representations of the read rule (CASL and SQL) must stay in sync; the consistency test
  guards that.
- 404 for out-of-scope rows makes some debugging less obvious.

## Alternatives considered

| Option                                         | Why not                                                                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Ownership checks inline in each service method | Easy to forget one; rules scattered                                                                   |
| CASL alone, filtering after loading            | Loads rows the caller may not see; pagination counts become wrong                                     |
| Postgres row-level security                    | Strong isolation, but needs per-request DB roles or session variables; better suited to multi-tenancy |
