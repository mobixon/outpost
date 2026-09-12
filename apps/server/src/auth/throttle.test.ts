import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateBackupCodes, hashBackupCode, looksLikeBackupCode } from './backup-codes.js';
import { FailureLimiter } from './throttle.js';

describe('FailureLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks a key after too many failures until the window ends', () => {
    const limiter = new FailureLimiter(3, 60_000);
    limiter.recordFailure('user:ann');
    limiter.recordFailure('user:ann');
    expect(limiter.blockedFor('user:ann')).toBe(0);
    limiter.recordFailure('user:ann');
    vi.setSystemTime(10_000);
    expect(limiter.blockedFor('user:ann')).toBe(50_000);
    expect(limiter.blockedFor('user:bob')).toBe(0);
    vi.setSystemTime(60_000);
    expect(limiter.blockedFor('user:ann')).toBe(0);
  });

  it('starts over after a reset', () => {
    const limiter = new FailureLimiter(1, 60_000);
    limiter.recordFailure('ip:1.2.3.4');
    expect(limiter.blockedFor('ip:1.2.3.4')).toBeGreaterThan(0);
    limiter.reset('ip:1.2.3.4');
    expect(limiter.blockedFor('ip:1.2.3.4')).toBe(0);
  });
});

describe('backup codes', () => {
  it('generates distinct, readable codes', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
  });

  it('matches codes regardless of case and separators', () => {
    expect(hashBackupCode('K7M2Q X9FHR')).toBe(hashBackupCode('k7m2q-x9fhr'));
    expect(looksLikeBackupCode('K7M2Q-X9FHR')).toBe(true);
    expect(looksLikeBackupCode('123456')).toBe(false);
  });
});
