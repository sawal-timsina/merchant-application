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
import { ApplicationStatus, ReviewDecisionType, RiskStatus } from '../domain/application.enums';
import { ApplicationEvent, isAssignable, nextStatus } from '../domain/application-state-machine';
import { MerchantApplication } from '../infrastructure/persistence/merchant-application.entity';
import { ReviewDecision } from '../infrastructure/persistence/review-decision.entity';
import type { DecisionDto } from '../presentation/application.dto';
import { ApplicationsService, ENTITY_TYPE } from './applications.service';

const DECISION_EVENT: Record<ReviewDecisionType, ApplicationEvent> = {
  APPROVE: ApplicationEvent.APPROVE,
  REJECT: ApplicationEvent.REJECT,
  REQUEST_INFO: ApplicationEvent.REQUEST_INFO,
};

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

  async decide(actor: Actor, id: string, dto: DecisionDto): Promise<MerchantApplication> {
    const reason = dto.reason?.trim() ?? '';
    if (dto.decision !== ReviewDecisionType.APPROVE && reason.length < 10) {
      throw new BusinessRuleError(
        'A reason of at least 10 characters is required to reject or request info',
      );
    }
    return this.dataSource.transaction(async (manager) => {
      // The row lock serialises concurrent decisions: the second sees the new status and gets 409.
      const application = await this.applications.findVisibleOrFail(manager, actor, id, true);
      this.applications.assertCan(actor, 'decide', application);
      const status = nextStatus(application.status, DECISION_EVENT[dto.decision]);

      await manager.insert(ReviewDecision, {
        applicationId: id,
        reviewerId: actor.id,
        decision: dto.decision,
        reason: reason || null,
      });
      const terminal =
        status === ApplicationStatus.APPROVED || status === ApplicationStatus.REJECTED;
      await manager.update(
        MerchantApplication,
        { id },
        { status, ...(terminal ? { decidedAt: new Date() } : {}) },
      );
      await this.audit.record(manager, {
        action: AuditAction.APPLICATION_DECISION_RECORDED,
        entityType: ENTITY_TYPE,
        entityId: id,
        metadata: { decision: dto.decision, from: application.status, to: status },
      });
      return manager.findOneByOrFail(MerchantApplication, { id });
    });
  }
}
