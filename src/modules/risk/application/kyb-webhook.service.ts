import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { WebhookEvent } from '../../../core/webhooks/webhook-event.entity';
import { ApplicationStatus } from '../../applications/domain/application.enums';
import { MerchantApplication } from '../../applications/infrastructure/persistence/merchant-application.entity';
import { RiskAssessmentStatus } from '../domain/risk.enums';
import { RiskAssessment } from '../infrastructure/persistence/risk-assessment.entity';
import type { KybWebhookDto } from '../presentation/kyb-webhook.dto';
import { RiskAssessmentCompleter } from './risk-assessment-completer';

const PROVIDER = 'kyb';

class DuplicateWebhook extends Error {}

export type KybWebhookOutcome = 'processed' | 'duplicate' | 'ignored';

@Injectable()
export class KybWebhookService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly completer: RiskAssessmentCompleter,
  ) {}

  /**
   * Receipt and processing share one transaction: a duplicate delivery hits the unique
   * constraint and is acknowledged; a processing failure rolls the receipt back so the
   * provider's retry is processed instead of being mistaken for a duplicate.
   */
  async handle(event: KybWebhookDto): Promise<KybWebhookOutcome> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const outcome = await this.process(manager, event);
        const inserted = await manager
          .createQueryBuilder()
          .insert()
          .into(WebhookEvent)
          .values({
            provider: PROVIDER,
            eventId: event.eventId,
            eventType: event.type,
            payload: { ...event },
            outcome,
          })
          .orIgnore()
          .returning(['id'])
          .execute();
        // RETURNING yields no row when ON CONFLICT DO NOTHING skipped the insert.
        if ((inserted.raw as unknown[]).length === 0) throw new DuplicateWebhook();
        return outcome;
      });
    } catch (error) {
      // Another delivery recorded this event first; the rollback undid anything process() did.
      if (error instanceof DuplicateWebhook) return 'duplicate';
      throw error;
    }
  }

  private async process(
    manager: EntityManager,
    event: KybWebhookDto,
  ): Promise<'processed' | 'ignored'> {
    const assessment = await manager.findOne(RiskAssessment, {
      where: { providerReference: event.reference, status: RiskAssessmentStatus.AWAITING_CALLBACK },
    });
    if (!assessment) return 'ignored';
    const application = await manager.findOne(MerchantApplication, {
      where: { id: assessment.applicationId },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !application ||
      application.submissionVersion !== assessment.submissionVersion ||
      application.status !== ApplicationStatus.SUBMITTED
    ) {
      return 'ignored';
    }
    // Re-read under the lock: a concurrent delivery may have completed it while we waited.
    const current = await manager.findOneByOrFail(RiskAssessment, { id: assessment.id });
    if (current.status !== RiskAssessmentStatus.AWAITING_CALLBACK) return 'ignored';

    await this.completer.complete(manager, {
      application,
      assessmentId: assessment.id,
      kyb: { reference: event.reference, ...event.data },
      correlationId: null,
    });
    return 'processed';
  }
}
