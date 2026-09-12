import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  totpAt,
  totpStep,
  totpUri,
  verifyTotp,
} from './totp.js';

describe('base32', () => {
  it.each([
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ])('encodes %j as %s (RFC 4648 vectors)', (plain, encoded) => {
    expect(base32Encode(Buffer.from(plain))).toBe(encoded);
    expect(base32Decode(encoded).toString()).toBe(plain);
  });

  it('decodes lowercase input with spaces and padding', () => {
    expect(base32Decode('mzxw 6ytb oi======').toString()).toBe('foobar');
  });

  it('rejects invalid characters', () => {
    expect(() => base32Decode('MZXW1')).toThrow(/Invalid base32/);
  });
});

describe('TOTP', () => {
  // RFC 6238 appendix B, SHA-1 variant, 8 digits.
  const rfcKey = Buffer.from('12345678901234567890');
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('matches the RFC 6238 vector at t=%i', (seconds, code) => {
    expect(hotp(rfcKey, totpStep(seconds * 1000), 8)).toBe(code);
  });

  const secret = generateTotpSecret();
  const now = 1_800_000_000_000;

  it('generates 160-bit secrets', () => {
    expect(base32Decode(secret)).toHaveLength(20);
  });

  it('accepts the current code and one step of drift, returning the step', () => {
    const step = totpStep(now);
    expect(verifyTotp(secret, totpAt(secret, now), now, null)).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, now - 30_000), now, null)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, now + 30_000), now, null)).toBe(step + 1);
  });

  it('rejects older codes, malformed codes and replays', () => {
    expect(verifyTotp(secret, totpAt(secret, now - 90_000), now, null)).toBeNull();
    expect(verifyTotp(secret, '12345', now, null)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now, null)).toBeNull();
    const step = totpStep(now);
    expect(verifyTotp(secret, totpAt(secret, now), now, step)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, now + 30_000), now, step)).toBe(step + 1);
  });

  it('builds an otpauth URI', () => {
    expect(totpUri('ABC', 'admin')).toBe(
      'otpauth://totp/Outpost%3Aadmin?secret=ABC&issuer=Outpost&algorithm=SHA1&digits=6&period=30',
    );
  });
});
