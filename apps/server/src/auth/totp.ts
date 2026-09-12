// Time-based one-time passwords (RFC 6238) as used by authenticator apps: SHA-1, 6 digits, 30 s.
import { createHmac, randomBytes } from 'node:crypto';
import { safeEqual } from './crypto.js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

/** RFC 4648 base32 without padding. */
export function base32Encode(data: Uint8Array): string {
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of data) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET.charAt((buffer >>> (bits - 5)) & 31);
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) output += BASE32_ALPHABET.charAt((buffer << (5 - bits)) & 31);
  return output;
}

/** Accepts lowercase, spaces, dashes and padding, as people type secrets in many ways. */
export function base32Decode(text: string): Buffer {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text.replace(/[\s=-]/g, '').toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid base32 character "${char}"`);
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
    buffer &= (1 << bits) - 1;
  }
  return Buffer.from(bytes);
}

/** A new random 160-bit secret (the size RFC 4226 recommends), base32-encoded. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(timeMs: number): number {
  return Math.floor(timeMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** HOTP value (RFC 4226) of a counter. */
export function hotp(key: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(message).digest();
  const offset = digest.readUInt8(digest.length - 1) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/** The code an authenticator app shows at the given time. */
export function totpAt(secret: string, timeMs: number): string {
  return hotp(base32Decode(secret), totpStep(timeMs));
}

/**
 * Checks a code and returns the time step it belongs to, or `null`. One step of clock drift is
 * accepted in both directions. Steps at or before `lastUsedStep` are rejected, so an intercepted
 * code cannot be replayed.
 */
export function verifyTotp(
  secret: string,
  code: string,
  timeMs: number,
  lastUsedStep: number | null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secret);
  const current = totpStep(timeMs);
  for (const step of [current - 1, current, current + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (safeEqual(hotp(key, step), code)) return step;
  }
  return null;
}

/** `otpauth://` URI understood by authenticator apps (usually shown as a QR code). */
export function totpUri(secret: string, account: string, issuer = 'Outpost'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
