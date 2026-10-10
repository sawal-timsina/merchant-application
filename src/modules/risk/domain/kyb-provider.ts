import type { KybResult } from './risk-scoring';

export const KYB_PROVIDER = Symbol('KYB_PROVIDER');

export interface KybProvider {
  verify(request: { applicationId: string; legalBusinessName: string }): Promise<KybResult>;
}

/** Transient provider failure: the job should be retried with backoff. */
export class KybUnavailableError extends Error {}

export const KYB_MODE = Symbol('KYB_MODE');
/** sync: the worker waits for the result. callback: the provider reports it later via webhook. */
export type KybMode = 'sync' | 'callback';

export const CALLBACK_KYB_PROVIDER = Symbol('CALLBACK_KYB_PROVIDER');

/** Asynchronous providers acknowledge the request now and deliver the result via webhook later. */
export interface CallbackKybProvider {
  requestVerification(request: {
    applicationId: string;
    legalBusinessName: string;
  }): Promise<{ reference: string }>;
}
