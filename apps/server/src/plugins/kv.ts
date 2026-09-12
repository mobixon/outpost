import type { KeyValueStore } from '@outpost/plugin-api';
import type { Kysely } from 'kysely';
import type { CoreTables } from '../db/schema.js';

/** Scope of instance-wide values; per-server scopes arrive together with servers. */
const GLOBAL_SCOPE = '';

export function createKeyValueStore(db: Kysely<CoreTables>, pluginId: string): KeyValueStore {
  const entry = (key: string) =>
    db
      .selectFrom('plugin_kv')
      .where('plugin_id', '=', pluginId)
      .where('scope', '=', GLOBAL_SCOPE)
      .where('key', '=', key);

  return {
    async get(key) {
      const row = await entry(key).select('value').executeTakeFirst();
      return row === undefined ? undefined : (JSON.parse(row.value) as unknown);
    },

    async set(key, value) {
      const json = JSON.stringify(value) as string | undefined;
      if (json === undefined) {
        throw new TypeError(`Cannot store "${key}": the value is not JSON-serializable`);
      }
      const now = Date.now();
      await db
        .insertInto('plugin_kv')
        .values({ plugin_id: pluginId, scope: GLOBAL_SCOPE, key, value: json, updated_at: now })
        .onConflict((conflict) =>
          conflict
            .columns(['plugin_id', 'scope', 'key'])
            .doUpdateSet({ value: json, updated_at: now }),
        )
        .execute();
    },

    async delete(key) {
      await db
        .deleteFrom('plugin_kv')
        .where('plugin_id', '=', pluginId)
        .where('scope', '=', GLOBAL_SCOPE)
        .where('key', '=', key)
        .execute();
    },
  };
}
