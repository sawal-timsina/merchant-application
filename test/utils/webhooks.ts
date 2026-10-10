import type { INestApplication } from '@nestjs/common';
import { signWebhook } from '../../src/core/webhooks/webhook-signature';
import { http } from './test-app';

export function signedKybRequest(
  app: INestApplication,
  body: object,
  opts: { secret?: string; timestamp?: number; rawOverride?: string } = {},
) {
  const raw = JSON.stringify(body);
  const secret = opts.secret ?? (process.env.KYB_WEBHOOK_SECRETS ?? '').split(',')[0]!;
  const header = signWebhook(raw, secret, opts.timestamp ?? Math.floor(Date.now() / 1000));
  return http(app)
    .post('/webhooks/kyb')
    .set('Content-Type', 'application/json')
    .set('X-Kyb-Signature', header)
    .send(opts.rawOverride ?? raw);
}
