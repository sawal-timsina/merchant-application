import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  type RawBodyRequest,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../../../core/config/env';
import { verifyWebhookSignature } from '../../../core/webhooks/webhook-signature';

export const KYB_SIGNATURE_HEADER = 'x-kyb-signature';

/** Runs before pipes: unsigned requests are rejected before their body is even validated. */
@Injectable()
export class KybSignatureGuard implements CanActivate {
  private readonly logger = new Logger(KybSignatureGuard.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const header = request.headers[KYB_SIGNATURE_HEADER];
    const result = verifyWebhookSignature({
      header: typeof header === 'string' ? header : undefined,
      rawBody: request.rawBody ?? Buffer.alloc(0),
      secrets: this.config.get('KYB_WEBHOOK_SECRETS', { infer: true }),
      toleranceSeconds: this.config.get('KYB_WEBHOOK_TOLERANCE_SECONDS', { infer: true }),
    });
    if (!result.ok) {
      this.logger.warn({ reason: result.reason }, 'Rejected KYB webhook');
      throw new UnauthorizedException('Invalid webhook signature');
    }
    return true;
  }
}
