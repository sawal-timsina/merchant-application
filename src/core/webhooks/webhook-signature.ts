import { createHmac, timingSafeEqual } from 'node:crypto';

const HEADER = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/;

const hmac = (secret: string, timestamp: number, rawBody: Buffer | string) =>
  createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();

export function signWebhook(rawBody: string, secret: string, timestamp: number): string {
  return `t=${timestamp},v1=${hmac(secret, timestamp, rawBody).toString('hex')}`;
}

export type WebhookVerification =
  | { ok: true; timestamp: number }
  | { ok: false; reason: 'missing' | 'malformed' | 'expired' | 'mismatch' };

/**
 * Verifies `t=<unix>,v1=<hex hmac>` over "<t>.<raw body>". The timestamp is inside the MAC, so it
 * cannot be altered to dodge the replay window; comparison is constant-time.
 */
export function verifyWebhookSignature(input: {
  header: string | undefined;
  rawBody: Buffer;
  secrets: string[];
  toleranceSeconds: number;
  nowSeconds?: number;
}): WebhookVerification {
  if (!input.header) return { ok: false, reason: 'missing' };
  const match = HEADER.exec(input.header.trim());
  if (!match) return { ok: false, reason: 'malformed' };

  const timestamp = Number(match[1]);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > input.toleranceSeconds) return { ok: false, reason: 'expired' };

  const provided = Buffer.from(match[2]!, 'hex');
  const valid = input.secrets.some((secret) => {
    const expected = hmac(secret, timestamp, input.rawBody);
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  });
  return valid ? { ok: true, timestamp } : { ok: false, reason: 'mismatch' };
}
