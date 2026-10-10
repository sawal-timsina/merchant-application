import { bigintToNumber } from './transformers';

describe('bigintToNumber', () => {
  it('converts pg BIGINT strings to numbers', () => {
    expect(bigintToNumber.from('1234567')).toBe(1_234_567);
  });

  it('passes NULL through', () => {
    expect(bigintToNumber.from(null)).toBeNull();
  });

  it('refuses values that would lose precision', () => {
    expect(() => bigintToNumber.from('9007199254740993')).toThrow(RangeError);
  });
});
