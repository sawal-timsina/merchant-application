import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BusinessRuleError, InvalidStateError } from '../../../core/domain/domain-error';
import { AuditService } from '../../audit/application/audit.service';
import { AuditAction } from '../../audit/domain/audit-action';
import type { Actor } from '../../identity/domain/actor';
import { UserRole } from '../../identity/domain/user-role';
import { User } from '../../identity/infrastructure/persistence/user.entity';
import { isAssignable } from '../domain/application-state-machine';
import { MerchantApplication } from '../infrastructure/persistence/merchant-application.entity';
import { ApplicationsService, ENTITY_TYPE } from './applications.service';

/** State-changing workflow steps: assignment, submission, decisions, risk retry. */
@Injectable()
export class ApplicationWorkflowService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly applications: ApplicationsService,
    private readonly audit: AuditService,
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
}
