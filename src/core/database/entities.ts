import { MerchantApplication } from '../../modules/applications/infrastructure/persistence/merchant-application.entity';
import { ReviewDecision } from '../../modules/applications/infrastructure/persistence/review-decision.entity';
import { AuditLog } from '../../modules/audit/infrastructure/persistence/audit-log.entity';
import { RefreshToken } from '../../modules/identity/infrastructure/persistence/refresh-token.entity';
import { User } from '../../modules/identity/infrastructure/persistence/user.entity';
import { OutboxEvent } from '../outbox/outbox-event.entity';
import { WebhookEvent } from '../webhooks/webhook-event.entity';
import { RiskAssessment } from '../../modules/risk/infrastructure/persistence/risk-assessment.entity';

export const entities = [
  User,
  RefreshToken,
  MerchantApplication,
  ReviewDecision,
  RiskAssessment,
  AuditLog,
  OutboxEvent,
  WebhookEvent,
];
