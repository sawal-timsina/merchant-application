import { type RiskInput, scoreApplication } from './risk-scoring';

const base: RiskInput = {
  mcc: '5812',
  expectedMonthlyVolumeCents: 1_000_000,
  averageTicketCents: 2_000,
  businessType: 'LLC',
};
const clean = { reference: 'kyb_1', businessVerified: true, watchlistHit: false };

describe('scoreApplication', () => {
  it('scores a small verified restaurant as LOW', () => {
    expect(scoreApplication(base, clean)).toEqual({ score: 10, level: 'LOW', reasons: [] });
  });

  it.each([
    ['high-risk MCC', { mcc: '7995' }, 50, 'MEDIUM'],
    ['high volume', { expectedMonthlyVolumeCents: 60_000_000 }, 30, 'LOW'],
    [
      'large tickets',
      { averageTicketCents: 600_000, expectedMonthlyVolumeCents: 6_000_000 },
      25,
      'LOW',
    ],
    ['sole proprietor', { businessType: 'SOLE_PROPRIETOR' }, 15, 'LOW'],
    [
      'everything',
      {
        mcc: '6051',
        expectedMonthlyVolumeCents: 60_000_000,
        averageTicketCents: 600_000,
        businessType: 'SOLE_PROPRIETOR',
      },
      90,
      'HIGH',
    ],
  ])('adds weight for %s', (_name, overrides, score, level) => {
    expect(scoreApplication({ ...base, ...overrides }, clean)).toMatchObject({ score, level });
  });

  it('forces HIGH (100) on a watchlist hit and +30 when the business is unverified', () => {
    expect(scoreApplication(base, { ...clean, watchlistHit: true })).toMatchObject({
      score: 100,
      level: 'HIGH',
    });
    expect(scoreApplication(base, { ...clean, businessVerified: false })).toMatchObject({
      score: 40,
      level: 'MEDIUM',
    });
  });

  it('never leaves 0..100', () => {
    const worst = scoreApplication(
      {
        mcc: '7995',
        expectedMonthlyVolumeCents: 9e12,
        averageTicketCents: 9e9,
        businessType: 'SOLE_PROPRIETOR',
      },
      { ...clean, businessVerified: false },
    );
    expect(worst.score).toBe(100);
  });
});
