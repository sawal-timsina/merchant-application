import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { signWebhook } from '../../../../core/webhooks/webhook-signature';
import {
  type CallbackKybProvider,
  type KybProvider,
  KybUnavailableError,
} from '../../domain/kyb-provider';
import type { KybResult } from '../../domain/risk-scoring';

/**
 * Stand-in for a third-party KYB API. Deterministic by business name so tests and demos are
 * reproducible ("WATCHLIST" → watchlist hit, "UNVERIFIED" → not verified); random latency and
 * transient failures exercise the retry path.
 */
export class FakeKybProvider implements KybProvider, CallbackKybProvider {
  constructor(
    private readonly options: {
      latencyMs: number;
      failureRate: number;
      random?: () => number;
      /** Callback mode: where and how to deliver the simulated webhook. */
      callback?: { url: string; secret: string };
    },
  ) {}

  async verify(request: { applicationId: string; legalBusinessName: string }): Promise<KybResult> {
    const random = this.options.random ?? Math.random;
    if (this.options.latencyMs > 0) await sleep(this.options.latencyMs * (0.5 + random()));
    if (random() < this.options.failureRate) {
      throw new KybUnavailableError('KYB provider temporarily unavailable');
    }

    return this.evaluate(request);
  }

  /** Acknowledges now and calls back later with a signed webhook, like an asynchronous provider. */
  async requestVerification(request: {
    applicationId: string;
    legalBusinessName: string;
  }): Promise<{ reference: string }> {
    const callback = this.options.callback;
    if (!callback) throw new Error('FakeKybProvider: callback options not configured');
    const random = this.options.random ?? Math.random;
    if (random() < this.options.failureRate) {
      throw new KybUnavailableError('KYB provider temporarily unavailable');
    }
    const reference = `kyb_${randomUUID()}`;
    const result = { ...this.evaluate(request), reference };
    const delay = Math.max(this.options.latencyMs, 50);
    // Fire-and-forget, like a third party. A lost callback is caught by the reaper's timeout.
    setTimeout(() => void this.deliver(callback, result), delay).unref();
    return { reference };
  }

  private evaluate(request: { applicationId: string; legalBusinessName: string }): KybResult {
    const name = request.legalBusinessName.toUpperCase();
    return {
      reference: `kyb_${createHash('sha256').update(request.applicationId).digest('hex').slice(0, 16)}`,
      businessVerified: !name.includes('UNVERIFIED'),
      watchlistHit: name.includes('WATCHLIST'),
    };
  }

  private async deliver(callback: { url: string; secret: string }, result: KybResult) {
    const body = JSON.stringify({
      eventId: `evt_${randomUUID()}`,
      type: 'kyb.verification.completed',
      reference: result.reference,
      data: { businessVerified: result.businessVerified, watchlistHit: result.watchlistHit },
      occurredAt: new Date().toISOString(),
    });
    const timestamp = Math.floor(Date.now() / 1000);
    await fetch(callback.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kyb-signature': signWebhook(body, callback.secret, timestamp),
      },
      body,
    }).catch(() => undefined);
  }
}
