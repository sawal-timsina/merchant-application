import type { ValueTransformer } from 'typeorm';

/**
 * pg returns BIGINT as string to avoid precision loss. Money in cents comfortably fits
 * in Number.MAX_SAFE_INTEGER (~90 trillion dollars), so we convert and fail loudly otherwise.
 */
export const bigintToNumber: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => {
    if (value === null) return null;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new RangeError(`BIGINT value ${value} exceeds Number.MAX_SAFE_INTEGER`);
    }
    return parsed;
  },
};
