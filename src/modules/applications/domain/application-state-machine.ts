import { InvalidStateError } from '../../../core/domain/domain-error';
import { ApplicationStatus } from './application.enums';

export const ApplicationEvent = {
  SUBMIT: 'SUBMIT',
  RISK_COMPLETED: 'RISK_COMPLETED',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  REQUEST_INFO: 'REQUEST_INFO',
} as const;
export type ApplicationEvent = (typeof ApplicationEvent)[keyof typeof ApplicationEvent];

const TRANSITIONS: Readonly<
  Record<ApplicationStatus, Partial<Record<ApplicationEvent, ApplicationStatus>>>
> = {
  DRAFT: { SUBMIT: 'SUBMITTED' },
  INFO_REQUESTED: { SUBMIT: 'SUBMITTED' },
  SUBMITTED: { RISK_COMPLETED: 'UNDER_REVIEW' },
  UNDER_REVIEW: { APPROVE: 'APPROVED', REJECT: 'REJECTED', REQUEST_INFO: 'INFO_REQUESTED' },
  APPROVED: {},
  REJECTED: {},
};

const EDITABLE = new Set<ApplicationStatus>([
  ApplicationStatus.DRAFT,
  ApplicationStatus.INFO_REQUESTED,
]);
const ASSIGNABLE = new Set<ApplicationStatus>([
  ApplicationStatus.SUBMITTED,
  ApplicationStatus.UNDER_REVIEW,
  ApplicationStatus.INFO_REQUESTED,
]);

export function nextStatus(current: ApplicationStatus, event: ApplicationEvent): ApplicationStatus {
  const next = TRANSITIONS[current][event];
  if (!next) {
    throw new InvalidStateError(
      `Cannot ${event.toLowerCase()} an application in status ${current}`,
    );
  }
  return next;
}

export const isEditable = (status: ApplicationStatus): boolean => EDITABLE.has(status);
export const isAssignable = (status: ApplicationStatus): boolean => ASSIGNABLE.has(status);
