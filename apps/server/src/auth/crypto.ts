import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** A random URL-safe token. 32 bytes give 256 bits of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Authenticated encryption (AES-256-GCM) for secrets stored in the database, such as TOTP
 * secrets. Each purpose gets its own key, derived from OUTPOST_SECRET_KEY with HKDF.
 */
export class SecretBox {
  readonly #key: Buffer;

  constructor(secretKey: string, purpose: string) {
    this.#key = Buffer.from(hkdfSync('sha256', secretKey, 'outpost', purpose, 32));
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const parts = [iv, data, cipher.getAuthTag()].map((part) => part.toString('base64url'));
    return ['v1', ...parts].join('.');
  }

  /** Throws when the value was not sealed with this key or has been modified. */
  open(sealed: string): string {
    const [version, iv, data, tag] = sealed.split('.');
    if (version !== 'v1' || iv === undefined || data === undefined || tag === undefined) {
      throw new Error('Unsupported sealed secret format');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.#key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
