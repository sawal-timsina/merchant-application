import type { KybResult } from './risk-scoring';

export const KYB_PROVIDER = Symbol('KYB_PROVIDER');

export interface KybProvider {
  verify(request: { applicationId: string; legalBusinessName: string }): Promise<KybResult>;
}

/** Transient provider failure: the job should be retried with backoff. */
export class KybUnavailableError extends Error {}
