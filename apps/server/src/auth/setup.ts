import { HttpError } from '@outpost/plugin-api';
import type { FastifyBaseLogger } from 'fastify';
import type { Kysely } from 'kysely';
import type { CoreTables } from '../db/schema.js';
import { randomToken, safeEqual } from './crypto.js';
import { countUsers } from './users.js';

/**
 * Guards the creation of the first administrator. Until an account exists, anyone who can reach
 * a fresh instance could claim it, so creating it needs a token that only the operator can see:
 * it is printed to the server log (or set with OUTPOST_SETUP_TOKEN).
 */
export class SetupGuard {
  #token: string | undefined;
  #busy = false;

  constructor(private readonly fixedToken: string | undefined) {}

  async init(db: Kysely<CoreTables>, log: FastifyBaseLogger): Promise<void> {
    if ((await countUsers(db)) > 0) return;
    if (this.fixedToken !== undefined) {
      this.#token = this.fixedToken;
      log.warn('No accounts yet: create the administrator in the web UI with OUTPOST_SETUP_TOKEN');
    } else {
      this.#token = randomToken(18);
      log.warn(
        `No accounts yet: create the administrator in the web UI with the setup token ${this.#token}`,
      );
    }
  }

  get required(): boolean {
    return this.#token !== undefined;
  }

  matches(token: string): boolean {
    return this.#token !== undefined && safeEqual(token, this.#token);
  }

  /** Runs the account creation; concurrent attempts are rejected so only one can succeed. */
  async run<T>(create: () => Promise<T>): Promise<T> {
    if (this.#busy) throw new HttpError(409, 'setup_in_progress', 'Setup is already in progress');
    this.#busy = true;
    try {
      if (!this.required) throw new HttpError(409, 'already_set_up', 'Outpost is already set up');
      const result = await create();
      this.#token = undefined;
      return result;
    } finally {
      this.#busy = false;
    }
  }
}
