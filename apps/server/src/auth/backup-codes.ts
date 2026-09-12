import { randomInt } from 'node:crypto';
import { sha256 } from './crypto.js';

// No characters that are easy to confuse when read from paper: 0/o, 1/l/i.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const BACKUP_CODE_COUNT = 10;

/** One-time recovery codes like `k7m2q-x9fhr` (about 49 bits of entropy each). */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const part = () =>
    Array.from({ length: 5 }, () => ALPHABET.charAt(randomInt(ALPHABET.length))).join('');
  return Array.from({ length: count }, () => `${part()}-${part()}`);
}

/** Lowercase without separators, so `K7M2Q X9FHR` matches `k7m2q-x9fhr`. */
export function normalizeBackupCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, '');
}

/** Codes are random enough that a plain SHA-256 is a sufficient one-way function. */
export function hashBackupCode(code: string): string {
  return sha256(normalizeBackupCode(code));
}

export function looksLikeBackupCode(code: string): boolean {
  return /^[a-z0-9]{10}$/.test(normalizeBackupCode(code));
}
