// Migrations are registered explicitly (not via glob) so the same list works for the
// compiled CLI, the app, and Jest (which cannot transform files TypeORM loads by path).
// Keep in timestamp order.
import { CreateUsers1791561180170 } from './1791561180170-CreateUsers';
import { CreateMerchantApplications1791561180171 } from './1791561180171-CreateMerchantApplications';
import { CreateReviewDecisions1791561180172 } from './1791561180172-CreateReviewDecisions';
import { CreateRiskAssessments1791561180173 } from './1791561180173-CreateRiskAssessments';
import { CreateAuditLogs1791561180174 } from './1791561180174-CreateAuditLogs';
import { CreateRefreshTokens1791564464566 } from './1791564464566-CreateRefreshTokens';
import { CreateOutboxEvents1791564464567 } from './1791564464567-CreateOutboxEvents';
import { AddTaxIdToMerchantApplications1791564464568 } from './1791564464568-AddTaxIdToMerchantApplications';

export const migrations = [
  CreateUsers1791561180170,
  CreateMerchantApplications1791561180171,
  CreateReviewDecisions1791561180172,
  CreateRiskAssessments1791561180173,
  CreateAuditLogs1791561180174,
  CreateRefreshTokens1791564464566,
  CreateOutboxEvents1791564464567,
  AddTaxIdToMerchantApplications1791564464568,
];
