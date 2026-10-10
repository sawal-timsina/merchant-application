export const RISK_REVIEW_QUEUE = 'risk-review';
export const RISK_REVIEW_DLQ = 'risk-review-dlq';

export interface RiskReviewJobData {
  applicationId: string;
  submissionVersion: number;
  correlationId: string | null;
}

/** Deterministic id: BullMQ ignores an add() whose jobId already exists, so re-publishing is harmless. */
export const riskJobId = (applicationId: string, submissionVersion: number) =>
  `risk-review_${applicationId}_${submissionVersion}`;
