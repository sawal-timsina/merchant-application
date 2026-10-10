export const ApplicationStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  INFO_REQUESTED: 'INFO_REQUESTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type ApplicationStatus = (typeof ApplicationStatus)[keyof typeof ApplicationStatus];

/** Aggregate risk state of the application's latest submission. */
export const RiskStatus = {
  NOT_STARTED: 'NOT_STARTED',
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type RiskStatus = (typeof RiskStatus)[keyof typeof RiskStatus];

export const BusinessType = {
  SOLE_PROPRIETOR: 'SOLE_PROPRIETOR',
  PARTNERSHIP: 'PARTNERSHIP',
  LLC: 'LLC',
  CORPORATION: 'CORPORATION',
  NON_PROFIT: 'NON_PROFIT',
} as const;
export type BusinessType = (typeof BusinessType)[keyof typeof BusinessType];

export const ReviewDecisionType = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  REQUEST_INFO: 'REQUEST_INFO',
} as const;
export type ReviewDecisionType = (typeof ReviewDecisionType)[keyof typeof ReviewDecisionType];

/** Kind of government tax/registration identifier; the number format differs per country. */
export const TaxIdType = {
  PAN: 'PAN',
  VAT: 'VAT',
  EIN: 'EIN',
  GSTIN: 'GSTIN',
  OTHER: 'OTHER',
} as const;
export type TaxIdType = (typeof TaxIdType)[keyof typeof TaxIdType];
