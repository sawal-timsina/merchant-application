import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { type KybProvider, KybUnavailableError } from '../../domain/kyb-provider';
import type { KybResult } from '../../domain/risk-scoring';

/**
 * Stand-in for a third-party KYB API. Deterministic by business name so tests and demos are
 * reproducible ("WATCHLIST" → watchlist hit, "UNVERIFIED" → not verified); random latency and
 * transient failures exercise the retry path.
 */
export class FakeKybProvider implements KybProvider {
  constructor(
    private readonly options: { latencyMs: number; failureRate: number; random?: () => number },
  ) {}

  async verify(request: { applicationId: string; legalBusinessName: string }): Promise<KybResult> {
    const random = this.options.random ?? Math.random;
    if (this.options.latencyMs > 0) await sleep(this.options.latencyMs * (0.5 + random()));
    if (random() < this.options.failureRate) {
      throw new KybUnavailableError('KYB provider temporarily unavailable');
    }

    const name = request.legalBusinessName.toUpperCase();
    return {
      reference: `kyb_${createHash('sha256').update(request.applicationId).digest('hex').slice(0, 16)}`,
      businessVerified: !name.includes('UNVERIFIED'),
      watchlistHit: name.includes('WATCHLIST'),
    };
  }
}
