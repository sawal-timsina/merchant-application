import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiErrors } from '../../../core/http/error.response';
import { Public } from '../../identity/presentation/public.decorator';
import { type KybWebhookOutcome, KybWebhookService } from '../application/kyb-webhook.service';
import { KYB_SIGNATURE_HEADER, KybSignatureGuard } from './kyb-signature.guard';
import { KybWebhookDto } from './kyb-webhook.dto';

@ApiTags('webhooks')
@Controller('webhooks')
export class KybWebhookController {
  constructor(private readonly webhooks: KybWebhookService) {}

  @Public() // not a user JWT: authenticated by the HMAC signature instead
  @SkipThrottle()
  @UseGuards(KybSignatureGuard)
  @Post('kyb')
  @HttpCode(200)
  @ApiHeader({
    name: KYB_SIGNATURE_HEADER,
    description: 't=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">',
  })
  @ApiOkResponse({ schema: { example: { status: 'processed' } } })
  @ApiErrors(400, 401)
  async kyb(@Body() event: KybWebhookDto): Promise<{ status: KybWebhookOutcome }> {
    return { status: await this.webhooks.handle(event) };
  }
}
