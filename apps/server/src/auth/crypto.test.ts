import { describe, expect, it } from 'vitest';
import { randomToken, safeEqual, SecretBox, sha256 } from './crypto.js';

describe('SecretBox', () => {
  const key = 'a-test-secret-key-that-is-long-enough';

  it('round-trips a secret and uses a fresh IV every time', () => {
    const box = new SecretBox(key, 'totp');
    const first = box.seal('JBSWY3DPEHPK3PXP');
    const second = box.seal('JBSWY3DPEHPK3PXP');
    expect(first).not.toBe(second);
    expect(box.open(first)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('rejects modified data, another purpose and another key', () => {
    const sealed = new SecretBox(key, 'totp').seal('secret');
    const [version, iv, data = '', tag] = sealed.split('.');
    const flipped = data.startsWith('A') ? `B${data.slice(1)}` : `A${data.slice(1)}`;
    const tampered = [version, iv, flipped, tag].join('.');
    expect(() => new SecretBox(key, 'totp').open(tampered)).toThrow();
    expect(() => new SecretBox(key, 'rcon').open(sealed)).toThrow();
    expect(() => new SecretBox(`${key}!`, 'totp').open(sealed)).toThrow();
    expect(() => new SecretBox(key, 'totp').open('garbage')).toThrow(/format/);
  });
});

describe('helpers', () => {
  it('creates distinct URL-safe tokens', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
  });

  it('hashes and compares', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
