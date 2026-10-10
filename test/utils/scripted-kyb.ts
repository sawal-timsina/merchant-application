import { type KybProvider, KybUnavailableError } from '../../src/modules/risk/domain/kyb-provider';
import type { KybResult } from '../../src/modules/risk/domain/risk-scoring';

/** Fails the first `failures` calls, then succeeds. Set failures = Infinity for a permanent outage. */
export class ScriptedKybProvider implements KybProvider {
  calls = 0;
  constructor(public failures = 0) {}

  async verify(): Promise<KybResult> {
    this.calls++;
    if (this.calls <= this.failures) throw new KybUnavailableError('scripted outage');
    return { reference: 'kyb_scripted', businessVerified: true, watchlistHit: false };
  }
}
