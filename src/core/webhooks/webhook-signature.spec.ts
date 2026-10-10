import { signWebhook, verifyWebhookSignature } from './webhook-signature';

const secret = 's'.repeat(32);
const body = JSON.stringify({ eventId: 'evt_1' });
const now = 1_800_000_000;
const verify = (header: string | undefined, raw = body, secrets = [secret], nowSeconds = now) =>
  verifyWebhookSignature({
    header,
    rawBody: Buffer.from(raw),
    secrets,
    toleranceSeconds: 300,
    nowSeconds,
  });

describe('webhook signatures', () => {
  it('accepts a correctly signed, fresh payload', () => {
    expect(verify(signWebhook(body, secret, now))).toEqual({ ok: true, timestamp: now });
  });

  it('accepts any configured secret (rotation)', () => {
    const old = 'old'.padEnd(32, 'x');
    expect(verify(signWebhook(body, old, now), body, [secret, old]).ok).toBe(true);
  });

  it.each([
    ['missing header', undefined, body, 'missing'],
    ['garbage header', 'nonsense', body, 'malformed'],
    ['non-hex signature', `t=${now},v1=zz`, body, 'malformed'],
    ['tampered body', signWebhook(body, secret, now), body.replace('evt_1', 'evt_2'), 'mismatch'],
    ['wrong secret', signWebhook(body, 'w'.repeat(32), now), body, 'mismatch'],
  ])('rejects %s', (_name, header, raw, reason) => {
    expect(verify(header, raw)).toEqual({ ok: false, reason });
  });

  it('rejects timestamps outside the tolerance window, both past and future', () => {
    expect(verify(signWebhook(body, secret, now - 301))).toEqual({ ok: false, reason: 'expired' });
    expect(verify(signWebhook(body, secret, now + 301))).toEqual({ ok: false, reason: 'expired' });
  });
});
