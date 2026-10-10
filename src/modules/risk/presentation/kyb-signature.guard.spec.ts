import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { signWebhook } from '../../../core/webhooks/webhook-signature';
import { KybSignatureGuard } from './kyb-signature.guard';

const secret = 'g'.repeat(32);
const now = () => Math.floor(Date.now() / 1000);
const config = { get: (key: string) => (key === 'KYB_WEBHOOK_SECRETS' ? [secret] : 300) };
const guard = new KybSignatureGuard(config as never);
const ctx = (headers: Record<string, string>, raw: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers, rawBody: Buffer.from(raw) }) }),
  }) as unknown as ExecutionContext;

describe('KybSignatureGuard', () => {
  const raw = '{"eventId":"e1"}';

  it('allows a valid signature', () => {
    const header = signWebhook(raw, secret, now());
    expect(guard.canActivate(ctx({ 'x-kyb-signature': header }, raw))).toBe(true);
  });

  it('rejects an invalid signature with 401', () => {
    const header = signWebhook(raw, 'x'.repeat(32), now());
    expect(() => guard.canActivate(ctx({ 'x-kyb-signature': header }, raw))).toThrow(
      UnauthorizedException,
    );
  });
});
