import {
  definePlugin,
  HttpError,
  PLUGIN_API_VERSION,
  sql,
  type PluginContext,
  type PluginDefinition,
} from '@outpost/plugin-api';
import {
  CorePermission,
  normalizeReason,
  parseBanList,
  parseWhitelist,
  stripFormatting,
} from '@outpost/shared';
import { z } from 'zod';
import {
  actionResultSchema,
  ipRequestSchema,
  modeRequestSchema,
  nameReasonRequestSchema,
  nameRequestSchema,
  overviewSchema,
  playerDetailSchema,
  playerPageSchema,
  playerQuerySchema,
  PLAYERS_PLUGIN_ID,
  PlayersPermission,
  whitelistStateRequestSchema,
  type ActionResult,
  type Overview,
} from '../shared.js';
import { migrations, type PlayersTables } from './tables.js';
import { PlayerTracker } from './tracker.js';

export interface PlayersPluginOptions {
  /** How often every connected server is asked who is online; 0 turns polling off (tests). */
  pollIntervalMs?: number;
}

const PRUNE_INTERVAL_MS = 6 * 60 * 60_000;
const iso = (time: number | null | undefined) =>
  time === null || time === undefined ? null : new Date(Number(time)).toISOString();

export function createPlayersPlugin(options: PlayersPluginOptions = {}): PluginDefinition {
  const pollIntervalMs = options.pollIntervalMs ?? 15_000;
  return definePlugin({
    id: PLAYERS_PLUGIN_ID,
    version: '0.1.0',
    apiVersion: PLUGIN_API_VERSION,
    games: ['minecraft-java'],
    migrations,
    permissions: [
      { key: PlayersPermission.view, roles: ['owner', 'admin', 'moderator', 'viewer'] },
      { key: PlayersPermission.kick, roles: ['owner', 'admin', 'moderator'] },
      { key: PlayersPermission.ban, roles: ['owner', 'admin', 'moderator'] },
      { key: PlayersPermission.whitelist, roles: ['owner', 'admin', 'moderator'] },
      { key: PlayersPermission.op, roles: ['owner', 'admin'] },
    ],
    setup: (ctx) => setup(ctx, pollIntervalMs),
  });
}

export default createPlayersPlugin();

function setup(ctx: PluginContext, pollIntervalMs: number): void {
  const db = ctx.db<PlayersTables>();
  const tracker = new PlayerTracker(ctx, db);
  const capability = 'commands.send';
  const send = (serverId: string, command: string) => ctx.commands.send(serverId, command);
  const result = (reply: string, extra: Partial<ActionResult> = {}): ActionResult => ({
    reply: stripFormatting(reply).trim(),
    pending: false,
    warning: null,
    ...extra,
  });

  if (pollIntervalMs > 0) {
    const pollAll = async () => {
      for (const server of await ctx.servers.list()) {
        if (!ctx.servers.supports(server) || !server.capabilities.includes(capability)) continue;
        tracker.poll(server.id).catch((err: unknown) => {
          ctx.logger.debug('polling the players failed', {
            serverId: server.id,
            error: String(err),
          });
        });
      }
    };
    const poller = setInterval(() => void pollAll().catch(() => undefined), pollIntervalMs);
    const pruner = setInterval(
      () => void tracker.prune(Date.now()).catch(() => undefined),
      PRUNE_INTERVAL_MS,
    );
    ctx.onShutdown(() => {
      clearInterval(poller);
      clearInterval(pruner);
    });
  }

  async function pendingOf(serverId: string) {
    const rows = await db
      .selectFrom('mc_pending_actions')
      .selectAll()
      .where('server_id', '=', serverId)
      .orderBy('created_at')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      action: row.action,
      reason: row.reason,
      createdBy: row.created_by,
      createdAt: new Date(Number(row.created_at)).toISOString(),
    }));
  }

  async function openSessions(serverId: string): Promise<Map<string, number>> {
    const rows = await db
      .selectFrom('mc_player_sessions')
      .select(['uuid', 'joined_at'])
      .where('server_id', '=', serverId)
      .where('left_at', 'is', null)
      .execute();
    return new Map(rows.map((row) => [row.uuid, Number(row.joined_at)]));
  }

  /** On offline servers, bans and operator rights for unseen players wait for them (see §6.3). */
  async function waitsForPlayer(serverId: string, name: string): Promise<boolean> {
    return (
      (await tracker.mode(serverId)).effective === 'offline' &&
      !(await tracker.seen(serverId, name))
    );
  }

  async function addPending(
    serverId: string,
    userId: string,
    action: 'ban' | 'op',
    name: string,
    reason: string | null,
  ) {
    const id = crypto.randomUUID();
    await db
      .insertInto('mc_pending_actions')
      .values({
        id,
        server_id: serverId,
        name,
        action,
        reason,
        created_by: userId,
        created_at: Date.now(),
      })
      .execute();
    return id;
  }

  ctx.http.serverRoute({
    method: 'GET',
    url: '/overview',
    permission: PlayersPermission.view,
    capability,
    schema: { response: overviewSchema },
    handler: async ({ server }): Promise<Overview> => {
      let reachable = true;
      let error: string | null = null;
      let list = null;
      let lists: Pick<Overview, 'whitelist' | 'bans' | 'ipBans'> = {
        whitelist: null,
        bans: null,
        ipBans: null,
      };
      try {
        list = await tracker.poll(server.id);
        const whitelist = parseWhitelist(await send(server.id, 'whitelist list'));
        const known = [...(await tracker.knownNames(server.id)), ...(whitelist ?? [])];
        lists = {
          whitelist,
          bans: parseBanList(await send(server.id, 'banlist players'), 'players', known),
          ipBans: parseBanList(await send(server.id, 'banlist ips'), 'ips'),
        };
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        reachable = false;
        error = err.code;
      }
      const since = await openSessions(server.id);
      const { effective, detected, override } = await tracker.mode(server.id);
      return {
        reachable,
        error,
        mode: { effective, detected, override },
        max: list?.max ?? null,
        online: (list?.players ?? []).flatMap((player) =>
          player.uuid === null
            ? []
            : [{ uuid: player.uuid, name: player.name, since: iso(since.get(player.uuid)) }],
        ),
        ...lists,
        pending: await pendingOf(server.id),
      };
    },
  });

  ctx.http.serverRoute({
    method: 'GET',
    url: '/players',
    permission: PlayersPermission.view,
    schema: { querystring: playerQuerySchema, response: playerPageSchema },
    handler: async ({ server, query }) => {
      let base = db.selectFrom('mc_players').where('server_id', '=', server.id);
      if (query.search) {
        base = base.where(
          sql<string>`lower(name)`,
          'like',
          `%${query.search.toLowerCase().replace(/[%_]/g, '')}%`,
        );
      }
      const [rows, count, since] = await Promise.all([
        base
          .selectAll()
          .orderBy('last_seen', 'desc')
          .limit(query.limit)
          .offset(query.offset)
          .execute(),
        base.select((eb) => eb.fn.countAll<number>().as('count')).executeTakeFirstOrThrow(),
        openSessions(server.id),
      ]);
      return {
        total: Number(count.count),
        players: rows.map((row) => ({
          uuid: row.uuid,
          name: row.name,
          firstSeen: new Date(Number(row.first_seen)).toISOString(),
          lastSeen: new Date(Number(row.last_seen)).toISOString(),
          playtimeMs: Number(row.playtime_ms),
          online: since.has(row.uuid),
        })),
      };
    },
  });

  ctx.http.serverRoute({
    method: 'GET',
    url: '/players/:uuid',
    permission: PlayersPermission.view,
    schema: { params: z.object({ uuid: z.string() }), response: playerDetailSchema },
    handler: async ({ server, params }) => {
      const row = await db
        .selectFrom('mc_players')
        .selectAll()
        .where('server_id', '=', server.id)
        .where('uuid', '=', params.uuid)
        .executeTakeFirst();
      if (row === undefined) throw new HttpError(404, 'not_found', 'No such player');
      const sessions = await db
        .selectFrom('mc_player_sessions')
        .select(['joined_at', 'left_at'])
        .where('server_id', '=', server.id)
        .where('uuid', '=', row.uuid)
        .orderBy('joined_at', 'desc')
        .limit(50)
        .execute();
      return {
        player: {
          uuid: row.uuid,
          name: row.name,
          firstSeen: new Date(Number(row.first_seen)).toISOString(),
          lastSeen: new Date(Number(row.last_seen)).toISOString(),
          playtimeMs: Number(row.playtime_ms),
          online: sessions[0]?.left_at === null,
        },
        sessions: sessions.map((session) => ({
          joinedAt: new Date(Number(session.joined_at)).toISOString(),
          leftAt: iso(session.left_at),
        })),
      };
    },
  });

  /** A player action: validates, runs the command and records it in the audit log. */
  function action<S extends z.ZodObject>(definition: {
    url: string;
    permission: string;
    body: S;
    run(serverId: string, userId: string, body: z.output<S>): Promise<ActionResult>;
    audit: (
      body: z.output<S>,
      result: ActionResult,
    ) => { action: string; target: string; details?: Record<string, unknown> };
  }): void {
    ctx.http.serverRoute({
      method: 'POST',
      url: definition.url,
      permission: definition.permission,
      capability,
      schema: { body: definition.body, response: actionResultSchema },
      handler: async ({ server, user, body, ip }) => {
        const outcome = await definition.run(server.id, user.id, body as z.output<S>);
        const entry = definition.audit(body as z.output<S>, outcome);
        await ctx.audit.record({ ...entry, userId: user.id, serverId: server.id, ip });
        return outcome;
      },
    });
  }

  action({
    url: '/kick',
    permission: PlayersPermission.kick,
    body: nameReasonRequestSchema,
    run: async (serverId, _userId, { name, reason }) => {
      const text = normalizeReason(reason);
      return result(await send(serverId, `kick ${name}${text ? ` ${text}` : ''}`));
    },
    audit: ({ name, reason }) => ({
      action: 'kick',
      target: name,
      details: { reason: reason ?? null },
    }),
  });

  action({
    url: '/ban',
    permission: PlayersPermission.ban,
    body: nameReasonRequestSchema,
    run: async (serverId, userId, { name, reason }) => {
      const text = normalizeReason(reason);
      if (await waitsForPlayer(serverId, name)) {
        await addPending(serverId, userId, 'ban', name, text || null);
        return result('', { pending: true });
      }
      return result(await send(serverId, `ban ${name}${text ? ` ${text}` : ''}`));
    },
    audit: ({ name, reason }, outcome) => ({
      action: outcome.pending ? 'pending_created' : 'ban',
      target: name,
      details: { reason: reason ?? null, ...(outcome.pending && { pendingAction: 'ban' }) },
    }),
  });

  action({
    url: '/pardon',
    permission: PlayersPermission.ban,
    body: nameRequestSchema,
    run: async (serverId, _userId, { name }) => result(await send(serverId, `pardon ${name}`)),
    audit: ({ name }) => ({ action: 'pardon', target: name }),
  });

  action({
    url: '/ban-ip',
    permission: PlayersPermission.ban,
    body: ipRequestSchema,
    run: async (serverId, _userId, { ip, reason }) => {
      const text = normalizeReason(reason);
      return result(await send(serverId, `ban-ip ${ip}${text ? ` ${text}` : ''}`));
    },
    audit: ({ ip, reason }) => ({
      action: 'ban_ip',
      target: ip,
      details: { reason: reason ?? null },
    }),
  });

  action({
    url: '/pardon-ip',
    permission: PlayersPermission.ban,
    body: ipRequestSchema,
    run: async (serverId, _userId, { ip }) => result(await send(serverId, `pardon-ip ${ip}`)),
    audit: ({ ip }) => ({ action: 'pardon_ip', target: ip }),
  });

  action({
    url: '/whitelist/add',
    permission: PlayersPermission.whitelist,
    body: nameRequestSchema,
    run: async (serverId, _userId, { name }) => {
      const warn = await waitsForPlayer(serverId, name);
      return result(await send(serverId, `whitelist add ${name}`), {
        warning: warn ? 'offline_unknown_player' : null,
      });
    },
    audit: ({ name }) => ({ action: 'whitelist_add', target: name }),
  });

  action({
    url: '/whitelist/remove',
    permission: PlayersPermission.whitelist,
    body: nameRequestSchema,
    run: async (serverId, _userId, { name }) =>
      result(await send(serverId, `whitelist remove ${name}`)),
    audit: ({ name }) => ({ action: 'whitelist_remove', target: name }),
  });

  action({
    url: '/whitelist/state',
    permission: PlayersPermission.whitelist,
    body: whitelistStateRequestSchema,
    run: async (serverId, _userId, { enabled }) =>
      result(await send(serverId, `whitelist ${enabled ? 'on' : 'off'}`)),
    audit: ({ enabled }) => ({ action: enabled ? 'whitelist_on' : 'whitelist_off', target: '' }),
  });

  action({
    url: '/op',
    permission: PlayersPermission.op,
    body: nameRequestSchema,
    run: async (serverId, userId, { name }) => {
      if (await waitsForPlayer(serverId, name)) {
        await addPending(serverId, userId, 'op', name, null);
        return result('', { pending: true });
      }
      return result(await send(serverId, `op ${name}`));
    },
    audit: ({ name }, outcome) => ({
      action: outcome.pending ? 'pending_created' : 'op',
      target: name,
      ...(outcome.pending && { details: { pendingAction: 'op' } }),
    }),
  });

  action({
    url: '/deop',
    permission: PlayersPermission.op,
    body: nameRequestSchema,
    run: async (serverId, _userId, { name }) => result(await send(serverId, `deop ${name}`)),
    audit: ({ name }) => ({ action: 'deop', target: name }),
  });

  /** A pending action, if the user may manage its kind (bans or operator rights). */
  async function pendingFor(serverId: string, id: string, permissions: ReadonlySet<string>) {
    const pending = await db
      .selectFrom('mc_pending_actions')
      .selectAll()
      .where('server_id', '=', serverId)
      .where('id', '=', id)
      .executeTakeFirst();
    if (pending === undefined) throw new HttpError(404, 'not_found', 'No such pending action');
    const needed = pending.action === 'ban' ? PlayersPermission.ban : PlayersPermission.op;
    if (!permissions.has(needed)) {
      throw new HttpError(403, 'forbidden', 'You do not have permission to do this');
    }
    return pending;
  }

  ctx.http.serverRoute({
    method: 'POST',
    url: '/pending/:id/apply',
    permission: PlayersPermission.view,
    capability,
    schema: { params: z.object({ id: z.string() }), response: actionResultSchema },
    handler: async ({ server, user, params, permissions, ip }) => {
      const pending = await pendingFor(server.id, params.id, permissions);
      const reply = await tracker.apply(server.id, pending);
      await ctx.audit.record({
        action: 'pending_forced',
        userId: user.id,
        serverId: server.id,
        target: pending.name,
        ip,
        details: { action: pending.action },
      });
      return result(reply);
    },
  });

  ctx.http.serverRoute({
    method: 'DELETE',
    url: '/pending/:id',
    permission: PlayersPermission.view,
    schema: { params: z.object({ id: z.string() }) },
    handler: async ({ server, user, params, permissions, ip }) => {
      const pending = await pendingFor(server.id, params.id, permissions);
      await db.deleteFrom('mc_pending_actions').where('id', '=', pending.id).execute();
      await ctx.audit.record({
        action: 'pending_cancelled',
        userId: user.id,
        serverId: server.id,
        target: pending.name,
        ip,
        details: { action: pending.action },
      });
      return { cancelled: true };
    },
  });

  ctx.http.serverRoute({
    method: 'PUT',
    url: '/mode',
    permission: CorePermission.manage,
    schema: { body: modeRequestSchema },
    handler: async ({ server, user, body, ip }) => {
      await tracker.setOverride(server.id, body.mode === 'auto' ? null : body.mode);
      await ctx.audit.record({
        action: 'mode_changed',
        userId: user.id,
        serverId: server.id,
        ip,
        details: { mode: body.mode },
      });
      return { mode: body.mode };
    },
  });
}
