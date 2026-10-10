import { relayBackoffMs } from './outbox-relay';

describe('relayBackoffMs', () => {
  it('grows exponentially from 1s and caps at 5 minutes', () => {
    expect(relayBackoffMs(1)).toBe(1_000);
    expect(relayBackoffMs(2)).toBe(2_000);
    expect(relayBackoffMs(5)).toBe(16_000);
    expect(relayBackoffMs(20)).toBe(300_000);
  });
});
