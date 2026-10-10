import { UserRole } from '../../identity/domain/user-role';
import { type ApplicationAccessFacts, applicationScope, can } from './application.policy';

const sales = { id: 'sales-1', role: UserRole.SALES };
const otherSales = { id: 'sales-2', role: UserRole.SALES };
const reviewer = { id: 'rev-1', role: UserRole.REVIEWER };
const otherReviewer = { id: 'rev-2', role: UserRole.REVIEWER };
const admin = { id: 'admin-1', role: UserRole.ADMIN };

const app: ApplicationAccessFacts = { createdById: 'sales-1', assignedReviewerId: 'rev-1' };

describe('application policy', () => {
  it.each([
    [sales, 'read', true],
    [sales, 'update', true],
    [sales, 'submit', true],
    [sales, 'decide', false],
    [sales, 'assign', false],
    [otherSales, 'read', false],
    [otherSales, 'update', false],
    [otherSales, 'submit', false],
    [reviewer, 'read', true],
    [reviewer, 'decide', true],
    [reviewer, 'update', false],
    [otherReviewer, 'read', false],
    [otherReviewer, 'decide', false],
    [admin, 'read', true],
    [admin, 'update', true],
    [admin, 'assign', true],
    [admin, 'retryRisk', true],
    [admin, 'decide', false], // only the assigned reviewer records decisions
  ] as const)('%o %s → %s', (actor, action, expected) => {
    expect(can(actor, action, app)).toBe(expected);
  });

  it('lets SALES and ADMIN create but not REVIEWER', () => {
    expect(can(sales, 'create')).toBe(true);
    expect(can(admin, 'create')).toBe(true);
    expect(can(reviewer, 'create')).toBe(false);
  });

  it('builds list scopes that match the read rule', () => {
    expect(applicationScope(sales)).toEqual({ createdById: 'sales-1' });
    expect(applicationScope(reviewer)).toEqual({ assignedReviewerId: 'rev-1' });
    expect(applicationScope(admin)).toEqual({});

    // Scope and ability must never disagree: a row matches the scope iff the actor can read it.
    const rows: ApplicationAccessFacts[] = [
      app,
      { createdById: 'sales-2', assignedReviewerId: null },
      { createdById: 'sales-2', assignedReviewerId: 'rev-2' },
    ];
    for (const actor of [sales, otherSales, reviewer, otherReviewer, admin]) {
      const scope = applicationScope(actor);
      for (const row of rows) {
        const inScope = Object.entries(scope).every(
          ([k, v]) => row[k as keyof ApplicationAccessFacts] === v,
        );
        expect(inScope).toBe(can(actor, 'read', row));
      }
    }
  });
});
