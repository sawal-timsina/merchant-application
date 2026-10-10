export const RiskAssessmentStatus = {
  PENDING: 'PENDING',
  /** Callback mode: the provider accepted the request and will report via webhook. */
  AWAITING_CALLBACK: 'AWAITING_CALLBACK',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type RiskAssessmentStatus = (typeof RiskAssessmentStatus)[keyof typeof RiskAssessmentStatus];

export const RiskLevel = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
} as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];
