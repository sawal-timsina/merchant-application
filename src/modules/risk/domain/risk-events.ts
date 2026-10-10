export const RiskEvent = {
  REVIEW_REQUESTED: 'RiskReviewRequested',
  REVIEW_RETRY_REQUESTED: 'RiskReviewRetryRequested',
} as const;

export interface RiskReviewRequestedPayload {
  applicationId: string;
  submissionVersion: number;
}
