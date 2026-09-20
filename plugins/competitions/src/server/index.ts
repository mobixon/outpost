import {
  definePlugin,
  HttpError,
  PLUGIN_API_VERSION,
  type PlayerTask,
  type PluginContext,
} from '@outpost/plugin-api';
import { stripFormatting } from '@outpost/shared';
import { z } from 'zod';
import {
  candidateListSchema,
  COMPETITIONS_PLUGIN_ID,
  CompetitionsPermission,
  eventConfigSchema,
  eventDetailSchema,
  eventInputSchema,
  eventListSchema,
  eventSchema,
  REWARD_COMMAND_PERMISSION,
  rewardTestInputSchema,
  rewardTestResultSchema,
  type CompetitionEvent,
  type EventDetail,
  type RewardStatus,
} from '../shared.js';
import {
  CompetitionEngine,
  configOf,
  DEFAULT_ENGINE_OPTIONS,
  toEvent,
  type EngineOptions,
  type EventRow,
} from './engine.js';
import { PlayerDirectory } from './players.js';
import {
  commandFailure,
  createRewardHandler,
  REWARD_KIND,
  rewardCommand,
  rewardPayloadSchema,
} from './rewards.js';
import { Sampler } from './sampler.js';
import { migrations, type CompetitionsTables } from './tables.js';
import { DEFAULT_TRIGGER_OPTIONS, Triggers, type TriggerOptions } from './triggers.js';

export interface CompetitionsPluginOptions {
  /** How often the competitions are looked at, and how often the standings are counted. */
  engine?: Partial<EngineOptions>;
  /** How players are answered in the chat (tests make it quick). */
  triggers?: Partial<TriggerOptions>;
}

export function createCompetitionsPlugin(options: CompetitionsPluginOptions = {}) {
  const engine: EngineOptions = { ...DEFAULT_ENGINE_OPTIONS, ...options.engine };
  const triggers: TriggerOptions = { ...DEFAULT_TRIGGER_OPTIONS, ...options.triggers };
  return definePlugin({
    id: COMPETITIONS_PLUGIN_ID,
    version: '0.1.0',
    apiVersion: PLUGIN_API_VERSION,
    // Counters, chat messages and rewards are those of Minecraft.
    games: ['minecraft-java'],
    dependsOn: ['outpost.players?'],
    files: { read: ['usercache.json', 'ops.json'] },
    migrations,
    permissions: [
      { key: CompetitionsPermission.view, roles: ['owner', 'admin', 'moderator', 'viewer'] },
      { key: CompetitionsPermission.manage, roles: ['owner', 'admin'] },
      { key: CompetitionsPermission.rewards, roles: ['owner', 'admin'] },
    ],
    setup: (ctx) => setup(ctx, engine, triggers),
  });
}

export default createCompetitionsPlugin();

const eventParams = z.object({ eventId: z.string() });
const rewardParams = eventParams.extend({ taskId: z.string() });
/** Competitions that are not over, at most this many per server. */
const MAX_OPEN_EVENTS = 20;

/** The UUID of a player Outpost does not know, for the tests of rewards. */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function setup(
  ctx: PluginContext,
  engineOptions: EngineOptions,
  triggerOptions: TriggerOptions,
): void {
  const db = ctx.db<CompetitionsTables>();
  const sampler = new Sampler(ctx);
  const directory = new PlayerDirectory(ctx);
  // The triggers need the engine and the engine reports to the triggers.
  const triggersRef: { current?: Triggers } = {};
  const engine = new CompetitionEngine(
    ctx,
    db,
    sampler,
    directory,
    (active) => triggersRef.current?.sync(active),
    engineOptions,
  );
  const triggers = new Triggers(ctx, db, engine, triggerOptions);
  triggersRef.current = triggers;

  ctx.playerTasks.handle(REWARD_KIND, createRewardHandler(ctx));
  ctx.events.on('outpost.started', () => {
    engine.start();
  });
  ctx.onShutdown(() => {
    engine.stop();
    triggers.stop();
  });

  async function rowOf(serverId: string, eventId: string): Promise<EventRow> {
    const row = await db
      .selectFrom('comp_events')
      .selectAll()
      .where('server_id', '=', serverId)
      .where('id', '=', eventId)
      .executeTakeFirst();
    if (row === undefined) throw new HttpError(404, 'not_found', 'No such competition');
    return row;
  }

  /** Reward commands run on the console, so setting them needs what the console needs. */
  function checkCommands(
    user: { isSuperadmin: boolean },
    permissions: ReadonlySet<string>,
    changed: boolean,
    hasCommands: boolean,
  ): void {
    if (!changed || !hasCommands) return;
    if (!user.isSuperadmin && !permissions.has(REWARD_COMMAND_PERMISSION)) {
      throw new HttpError(403, 'forbidden', 'You do not have permission to do this');
    }
  }

  /** The commands of rewards are shown only to those who manage the competitions. */
  function visible(event: CompetitionEvent, permissions: ReadonlySet<string>): CompetitionEvent {
    if (permissions.has(CompetitionsPermission.manage)) return event;
    return {
      ...event,
      rewards: { places: event.rewards.places.map((reward) => ({ ...reward, commands: [] })) },
    };
  }

  function rewardStatus(task: PlayerTask, showCommands: boolean): RewardStatus[] {
    const parsed = rewardPayloadSchema.safeParse(task.payload);
    if (!parsed.success) return [];
    return [
      {
        id: task.id,
        place: parsed.data.place,
        index: parsed.data.index,
        playerUuid: task.playerUuid,
        playerName: task.playerName,
        command: showCommands ? parsed.data.command : '',
        status: task.status,
        attempts: task.attempts,
        error: showCommands ? task.error : null,
        updatedAt: task.updatedAt.toISOString(),
      },
    ];
  }

  async function detailOf(
    row: EventRow,
    server: { id: string; capabilities: readonly string[] },
    permissions: ReadonlySet<string>,
  ): Promise<EventDetail> {
    const showCommands = permissions.has(CompetitionsPermission.manage);
    const tasks =
      row.state === 'finishing' || row.state === 'finished'
        ? await ctx.playerTasks.list({ serverId: server.id, kind: REWARD_KIND })
        : [];
    const rewards = tasks
      .filter((task) => rewardPayloadSchema.safeParse(task.payload).data?.eventId === row.id)
      .flatMap((task) => rewardStatus(task, showCommands))
      .sort((a, b) => a.place - b.place || a.index - b.index);
    const { rows: progress, completed } = await engine.progress(row);
    return {
      event: visible(toEvent(row), permissions),
      standings: await engine.standings(row),
      progress,
      completedCount: completed,
      countedAt: row.counted_at === null ? null : new Date(Number(row.counted_at)).toISOString(),
      rewards,
      capabilities: {
        stats: server.capabilities.includes('stats.read'),
        chat: server.capabilities.includes('chat.tell'),
        events: server.capabilities.includes('game.events'),
        tasks: server.capabilities.includes('players.whenOnline'),
      },
    };
  }

  const auditDetails = (row: EventRow) => ({
    name: row.name,
    startsAt: new Date(Number(row.starts_at)).toISOString(),
    endsAt: new Date(Number(row.ends_at)).toISOString(),
    ...configOf(row),
  });

  ctx.http.serverRoute({
    method: 'GET',
    url: '/events',
    permission: CompetitionsPermission.view,
    schema: { response: eventListSchema },
    handler: async ({ server, permissions }) => {
      const rows = await db
        .selectFrom('comp_events')
        .selectAll()
        .where('server_id', '=', server.id)
        .orderBy('starts_at', 'desc')
        .execute();
      return { events: rows.map((row) => visible(toEvent(row), permissions)) };
    },
  });

  ctx.http.serverRoute({
    method: 'GET',
    url: '/events/:eventId',
    permission: CompetitionsPermission.view,
    schema: { params: eventParams, response: eventDetailSchema },
    handler: async ({ params, server, permissions }) =>
      detailOf(await rowOf(server.id, params.eventId), server, permissions),
  });

  ctx.http.serverRoute({
    method: 'POST',
    url: '/events',
    permission: CompetitionsPermission.manage,
    capability: 'stats.read',
    schema: { body: eventInputSchema, response: eventSchema },
    handler: async ({ body, server, user, permissions, ip }) => {
      const endsAt = Date.parse(body.endsAt);
      if (endsAt <= Date.now()) {
        throw new HttpError(400, 'invalid_period', 'The competition must end in the future');
      }
      checkCommands(user, permissions, true, body.rewards.places.length > 0);
      const open = await db
        .selectFrom('comp_events')
        .select(db.fn.countAll().as('count'))
        .where('server_id', '=', server.id)
        .where('state', 'in', ['scheduled', 'active', 'finishing'])
        .executeTakeFirst();
      if (Number(open?.count ?? 0) >= MAX_OPEN_EVENTS) {
        throw new HttpError(409, 'too_many_events', 'Too many competitions are not over yet');
      }
      const row = await engine.create(server.id, user.id, {
        name: body.name,
        timezone: body.timezone,
        startsAt: Date.parse(body.startsAt),
        endsAt,
        config: eventConfigSchema.parse(body),
      });
      await ctx.audit.record({
        action: 'event_created',
        userId: user.id,
        serverId: server.id,
        target: row.name,
        details: auditDetails(row),
        ip,
      });
      return visible(toEvent(row), permissions);
    },
  });

  ctx.http.serverRoute({
    method: 'PUT',
    url: '/events/:eventId',
    permission: CompetitionsPermission.manage,
    schema: { params: eventParams, body: eventInputSchema, response: eventSchema },
    handler: async ({ params, body, server, user, permissions, ip }) => {
      const row = await rowOf(server.id, params.eventId);
      const scope = CompetitionEngine.editable(row.state);
      if (scope === null) {
        throw new HttpError(409, 'event_over', 'A competition that is over cannot be changed');
      }
      const current = configOf(row);
      const config = eventConfigSchema.parse(body);
      const startsAt = Date.parse(body.startsAt);
      const endsAt = Date.parse(body.endsAt);
      if (endsAt <= Date.now()) {
        throw new HttpError(400, 'invalid_period', 'The competition must end in the future');
      }
      if (
        scope === 'running' &&
        (!same(config.metric, current.metric) ||
          !same(config.scoring, current.scoring) ||
          startsAt !== Number(row.starts_at))
      ) {
        throw new HttpError(
          409,
          'event_running',
          'What is counted and the start cannot change once the competition has started',
        );
      }
      checkCommands(
        user,
        permissions,
        !same(config.rewards, current.rewards),
        body.rewards.places.length > 0,
      );
      await db
        .updateTable('comp_events')
        .set({
          name: body.name,
          timezone: body.timezone,
          starts_at: scope === 'all' ? Math.max(startsAt, Date.now()) : Number(row.starts_at),
          ends_at: endsAt,
          config: JSON.stringify(config),
          updated_at: Date.now(),
        })
        .where('id', '=', row.id)
        .execute();
      const updated = await rowOf(server.id, row.id);
      // Who takes part may have changed: the standings are counted again.
      if (updated.state === 'active' && !same(config.participants, current.participants)) {
        directory.forget();
        void engine.count(updated).catch(() => undefined);
      }
      if (!same(config.metric, current.metric) || !same(config.scoring, current.scoring)) {
        sampler.forget(row.id);
      }
      await ctx.audit.record({
        action: 'event_updated',
        userId: user.id,
        serverId: server.id,
        target: row.name,
        details: auditDetails(updated),
        ip,
      });
      void engine.tick();
      return visible(toEvent(updated), permissions);
    },
  });

  ctx.http.serverRoute({
    method: 'POST',
    url: '/events/:eventId/count',
    permission: CompetitionsPermission.manage,
    capability: 'stats.read',
    schema: { params: eventParams, response: eventDetailSchema },
    handler: async ({ params, server, user, permissions, ip }) => {
      const row = await rowOf(server.id, params.eventId);
      if (row.state !== 'active') {
        throw new HttpError(409, 'event_not_running', 'Only a running event can be counted now');
      }
      await engine.recount(row);
      await ctx.audit.record({
        action: 'event_recounted',
        userId: user.id,
        serverId: server.id,
        target: row.name,
        ip,
      });
      return detailOf(await rowOf(server.id, row.id), server, permissions);
    },
  });

  ctx.http.serverRoute({
    method: 'POST',
    url: '/events/:eventId/cancel',
    permission: CompetitionsPermission.manage,
    schema: { params: eventParams, response: eventSchema },
    handler: async ({ params, server, user, permissions, ip }) => {
      const row = await rowOf(server.id, params.eventId);
      if (row.state !== 'scheduled' && row.state !== 'active') {
        throw new HttpError(409, 'event_over', 'This competition is not running or waiting');
      }
      await engine.cancel(row);
      await ctx.audit.record({
        action: 'event_cancelled',
        userId: user.id,
        serverId: server.id,
        target: row.name,
        details: { name: row.name, state: row.state },
        ip,
      });
      return visible(toEvent(await rowOf(server.id, row.id)), permissions);
    },
  });

  ctx.http.serverRoute({
    method: 'DELETE',
    url: '/events/:eventId',
    permission: CompetitionsPermission.manage,
    schema: { params: eventParams },
    handler: async ({ params, server, user, ip }) => {
      const row = await rowOf(server.id, params.eventId);
      if (row.state === 'active' || row.state === 'finishing') {
        throw new HttpError(409, 'event_running', 'Cancel the competition before deleting it');
      }
      await engine.remove(row);
      await ctx.audit.record({
        action: 'event_deleted',
        userId: user.id,
        serverId: server.id,
        target: row.name,
        details: { name: row.name, state: row.state },
        ip,
      });
      return { deleted: true };
    },
  });

  /** A reward that was not given: to try again or to give up. */
  for (const action of ['retry', 'cancel'] as const) {
    ctx.http.serverRoute({
      method: 'POST',
      url: `/events/:eventId/rewards/:taskId/${action}`,
      permission: CompetitionsPermission.rewards,
      schema: { params: rewardParams },
      handler: async ({ params, server, user, ip }) => {
        const row = await rowOf(server.id, params.eventId);
        const task = (await ctx.playerTasks.list({ serverId: server.id, kind: REWARD_KIND })).find(
          (candidate) =>
            candidate.id === params.taskId &&
            rewardPayloadSchema.safeParse(candidate.payload).data?.eventId === row.id,
        );
        if (task === undefined) throw new HttpError(404, 'not_found', 'No such reward');
        const done = await (action === 'retry'
          ? ctx.playerTasks.retry(task.id)
          : ctx.playerTasks.cancel(task.id));
        if (!done) {
          throw new HttpError(409, 'reward_over', 'This reward is already given or cancelled');
        }
        await ctx.audit.record({
          action: action === 'retry' ? 'reward_retried' : 'reward_cancelled',
          userId: user.id,
          serverId: server.id,
          target: row.name,
          details: { player: task.playerName, taskId: task.id },
          ip,
        });
        return { ok: true };
      },
    });
  }

  /** Runs the commands of a reward for a player who is online, to see that they work. */
  ctx.http.serverRoute({
    method: 'POST',
    url: '/rewards/test',
    permission: CompetitionsPermission.manage,
    capability: 'commands.send',
    schema: { body: rewardTestInputSchema, response: rewardTestResultSchema },
    handler: async ({ body, server, user, permissions, ip }) => {
      checkCommands(user, permissions, true, true);
      const known = [...(await directory.names(server.id))].find(
        ([, name]) => name.toLowerCase() === body.player.toLowerCase(),
      );
      const winner = { name: body.player, uuid: known?.[0] ?? NIL_UUID };
      const results: { command: string; reply: string; ok: boolean }[] = [];
      for (const command of body.commands) {
        const text = rewardCommand(command, winner, {
          eventName: body.eventName,
          place: body.place,
          score: 0,
        });
        const reply = await ctx.commands.send(server.id, text);
        results.push({
          command: text,
          reply: stripFormatting(reply).trim().slice(0, 500),
          ok: commandFailure(reply) === null,
        });
      }
      await ctx.audit.record({
        action: 'reward_tested',
        userId: user.id,
        serverId: server.id,
        target: body.player,
        details: { place: body.place, commands: results.map(({ command }) => command) },
        ip,
      });
      return { results };
    },
  });

  ctx.http.serverRoute({
    method: 'GET',
    url: '/players',
    permission: CompetitionsPermission.manage,
    schema: { response: candidateListSchema },
    handler: async ({ server }) => {
      directory.forget();
      const operators = await directory.operators(server.id);
      const names = await directory.names(server.id);
      return {
        players: [...names]
          .map(([uuid, name]) => ({ uuid, name, operator: operators.has(uuid) }))
          .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })),
      };
    },
  });
}
