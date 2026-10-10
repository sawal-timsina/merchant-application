import { InvalidStateError } from '../../../core/domain/domain-error';
import { ApplicationStatus as S } from './application.enums';
import {
  ApplicationEvent as E,
  isAssignable,
  isEditable,
  nextStatus,
} from './application-state-machine';

const allowed: Array<[S, E, S]> = [
  [S.DRAFT, E.SUBMIT, S.SUBMITTED],
  [S.INFO_REQUESTED, E.SUBMIT, S.SUBMITTED],
  [S.SUBMITTED, E.RISK_COMPLETED, S.UNDER_REVIEW],
  [S.UNDER_REVIEW, E.APPROVE, S.APPROVED],
  [S.UNDER_REVIEW, E.REJECT, S.REJECTED],
  [S.UNDER_REVIEW, E.REQUEST_INFO, S.INFO_REQUESTED],
];

describe('application state machine', () => {
  it.each(allowed)('%s --%s--> %s', (from, event, to) => {
    expect(nextStatus(from, event)).toBe(to);
  });

  const forbidden = Object.values(S).flatMap((from) =>
    Object.values(E)
      .filter((event) => !allowed.some(([f, e]) => f === from && e === event))
      .map((event) => [from, event] as const),
  );

  it.each(forbidden)('rejects %s --%s-->', (from, event) => {
    expect(() => nextStatus(from, event)).toThrow(InvalidStateError);
  });

  it('treats approved and rejected as terminal', () => {
    for (const event of Object.values(E)) {
      expect(() => nextStatus(S.APPROVED, event)).toThrow(InvalidStateError);
      expect(() => nextStatus(S.REJECTED, event)).toThrow(InvalidStateError);
    }
  });

  it('allows edits only before submission or when info was requested', () => {
    expect(Object.values(S).filter(isEditable)).toEqual([S.DRAFT, S.INFO_REQUESTED]);
  });

  it('allows reviewer assignment only while review is pending', () => {
    expect(Object.values(S).filter(isAssignable)).toEqual([
      S.SUBMITTED,
      S.UNDER_REVIEW,
      S.INFO_REQUESTED,
    ]);
  });
});
