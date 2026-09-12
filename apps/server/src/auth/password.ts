import { hash, verify } from '@node-rs/argon2';

// argon2id with the minimum OWASP recommends: 19 MiB of memory, 2 iterations, 1 lane.
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

let timingEqualizer: Promise<string> | undefined;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Checks a password against a stored hash. Without a stored hash (unknown user, or an account
 * without a password) it does the same work and fails, so response times do not reveal which
 * usernames exist.
 */
export async function verifyPassword(
  storedHash: string | null,
  password: string,
): Promise<boolean> {
  timingEqualizer ??= hash('outpost-timing-equalizer', ARGON2_OPTIONS);
  const target = storedHash ?? (await timingEqualizer);
  let matches: boolean;
  try {
    matches = await verify(target, password);
  } catch {
    matches = false;
  }
  return storedHash !== null && matches;
}

/** Rules beyond the length limits of the request schemas. Returns an error code or null. */
export function passwordProblem(
  password: string,
  username: string,
): 'password_contains_username' | null {
  return password.toLowerCase().includes(username.toLowerCase())
    ? 'password_contains_username'
    : null;
}
