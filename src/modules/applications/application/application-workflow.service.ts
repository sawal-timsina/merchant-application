import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BusinessRuleError, InvalidStateError } from '../../../core/domain/domain-error';
import { OutboxService } from '../../../core/outbox/outbox.service';
import { AuditService } from '../../audit/application/audit.service';
import { AuditAction } from '../../audit/domain/audit-action';
import type { Actor } from '../../identity/domain/actor';
import { UserRole } from '../../identity/domain/user-role';
import { User } from '../../identity/infrastructure/persistence/user.entity';
import { RiskEvent, type RiskReviewRequestedPayload } from '../../risk/domain/risk-events';
import { RiskAssessmentStatus } from '../../risk/domain/risk.enums';
import { RiskAssessment } from '../../risk/infrastructure/persistence/risk-assessment.entity';
import { RiskStatus } from '../domain/application.enums';
import { ApplicationEvent, isAssignable, nextStatus } from '../domain/application-state-machine';
import { MerchantApplication } from '../infrastructure/persistence/merchant-application.entity';
import { ApplicationsService, ENTITY_TYPE } from './applications.service';

/** State-changing workflow steps: assignment, submission, decisions, risk retry. */
@Injectable()
export class ApplicationWorkflowService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly applications: ApplicationsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async assignReviewer(actor: Actor, id: string, reviewerId: string): Promise<MerchantApplication> {
    return this.dataSource.transaction(async (manager) => {
      const application = await this.applications.findVisibleOrFail(manager, actor, id, true);
      this.applications.assertCan(actor, 'assign', application);
      if (!isAssignable(application.status)) {
        throw new InvalidStateError(`Cannot assign a reviewer in status ${application.status}`);
      }
      const reviewer = await manager.findOneBy(User, {
        id: reviewerId,
        role: UserRole.REVIEWER,
        isActive: true,
      });
      if (!reviewer) throw new BusinessRuleError('reviewerId must reference an active REVIEWER');

      await manager.update(MerchantApplication, { id }, { assignedReviewerId: reviewerId });
      await this.audit.record(manager, {
        action: AuditAction.APPLICATION_REVIEWER_ASSIGNED,
        entityType: ENTITY_TYPE,
        entityId: id,
        metadata: { reviewerId, previousReviewerId: application.assignedReviewerId },
      });
      return manager.findOneByOrFail(MerchantApplication, { id });
    });
  }

  async submit(actor: Actor, id: string): Promise<MerchantApplication> {
    return this.dataSource.transaction(async (manager) => {
      const application = await this.applications.findVisibleOrFail(manager, actor, id, true);
      this.applications.assertCan(actor, 'submit', application);
      const status = nextStatus(application.status, ApplicationEvent.SUBMIT);
      if (!application.taxIdType) {
        throw new BusinessRuleError('A tax id is required before submission');
      }

      const submissionVersion = application.submissionVersion + 1;
      await manager.update(
        MerchantApplication,
        { id },
        { status, riskStatus: RiskStatus.PENDING, submissionVersion, submittedAt: new Date() },
      );
      const payload: RiskReviewRequestedPayload = { applicationId: id, submissionVersion };
      await this.outbox.enqueue(manager, {
        aggregateType: ENTITY_TYPE,
        aggregateId: id,
        eventType: RiskEvent.REVIEW_REQUESTED,
        payload: { ...payload },
      });
      await this.audit.record(manager, {
        action: AuditAction.APPLICATION_SUBMITTED,
        entityType: ENTITY_TYPE,
        entityId: id,
        metadata: { submissionVersion },
      });
      return manager.findOneByOrFail(MerchantApplication, { id });
    });
  }

  async retryRisk(actor: Actor, id: string): Promise<MerchantApplication> {
    return this.dataSource.transaction(async (manager) => {
      const application = await this.applications.findVisibleOrFail(manager, actor, id, true);
      this.applications.assertCan(actor, 'retryRisk', application);
      if (application.riskStatus !== RiskStatus.FAILED) {
        throw new InvalidStateError(
          `Risk review can only be retried when FAILED (is ${application.riskStatus})`,
        );
      }
      await manager.update(MerchantApplication, { id }, { riskStatus: RiskStatus.PENDING });
      await manager.update(
        RiskAssessment,
        { applicationId: id, submissionVersion: application.submissionVersion },
        { status: RiskAssessmentStatus.PENDING, lastError: null },
      );
      await this.outbox.enqueue(manager, {
        aggregateType: ENTITY_TYPE,
        aggregateId: id,
        eventType: RiskEvent.REVIEW_RETRY_REQUESTED,
        payload: { applicationId: id, submissionVersion: application.submissionVersion },
      });
      await this.audit.record(manager, {
        action: AuditAction.RISK_REVIEW_RETRIED,
        entityType: ENTITY_TYPE,
        entityId: id,
        metadata: { submissionVersion: application.submissionVersion },
      });
      return manager.findOneByOrFail(MerchantApplication, { id });
    });
  }
}
