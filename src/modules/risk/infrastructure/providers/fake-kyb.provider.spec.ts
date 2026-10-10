import { KybUnavailableError } from '../../domain/kyb-provider';
import { FakeKybProvider } from './fake-kyb.provider';

const req = { applicationId: 'a1', legalBusinessName: 'Acme Pvt Ltd' };

describe('FakeKybProvider', () => {
  it('verifies normal businesses with a stable reference', async () => {
    const provider = new FakeKybProvider({ latencyMs: 0, failureRate: 0 });
    const result = await provider.verify(req);
    expect(result).toEqual({
      reference: expect.stringMatching(/^kyb_/),
      businessVerified: true,
      watchlistHit: false,
    });
    expect((await provider.verify(req)).reference).toBe(result.reference);
  });

  it('simulates watchlist hits and unverifiable businesses by name', async () => {
    const provider = new FakeKybProvider({ latencyMs: 0, failureRate: 0 });
    const watch = await provider.verify({ ...req, legalBusinessName: 'WATCHLIST Traders' });
    const unverified = await provider.verify({ ...req, legalBusinessName: 'UNVERIFIED Co' });
    expect(watch.watchlistHit).toBe(true);
    expect(unverified.businessVerified).toBe(false);
  });

  it('fails transiently according to the failure rate', async () => {
    const provider = new FakeKybProvider({ latencyMs: 0, failureRate: 0.5, random: () => 0.4 });
    await expect(provider.verify(req)).rejects.toBeInstanceOf(KybUnavailableError);
  });
});
