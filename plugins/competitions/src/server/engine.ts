import { HttpError, type Kysely, type PluginContext } from '@outpost/plugin-api';
import { z } from 'zod';
import {
  announcementKey,
  eventConfigSchema,
  standingSchema,
  type Metric,
  type ProgressRow,
  type Rewards,
  type CompetitionEvent,
  type EventConfig,
  type EventState,
  type Standing,
} from '../shared.js';
import {
  goalView,
  renderAnnouncement,
  renderCompletion,
  renderResults,
  type GoalView,
} from '../render.js';
import type { PlayerDirectory } from './players.js';
import { REWARD_KIND, rewardPayloadSchema, type RewardPayload } from './rewards.js';
import type { Sampler } from './sampler.js';
import type { CompetitionsTables } from './tables.js';

export type EventRow = CompetitionsTables['comp_events'];

export interface EngineOptions {
  /** How often the competitions are looked at: started, counted, finished. */
  tickMs: number;
  /** Counts standings this often instead of as often as each event says (tests). */
  countIntervalMs?: number;
}

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = { tickMs: 15_000 };
/** An announcement that is late by more than this (Outpost was down) is left out. */
const ANNOUNCE_GRACE_MS = 3 * 60_000;
/** Rewards of a competition that ended longer ago are not waited for at the door. */
const REWARD_WATCH_MS = 30 * 24 * 60 * 60_000;
/** Rows of the baselines are inserted this many at a time. */
const INSERT_CHUNK = 200;

const iso = (time: number) => new Date(Number(time)).toISOString();
const resultsSchema = z.array(standingSchema);

/** The metrics an event reads: its one metric, or the metric of each of its targets. */
export function metricsOf(config: EventConfig): Metric[] {
  if (config.scoring.kind === 'targets') return config.scoring.targets.map(({ metric }) => metric);
  return config.metric === undefined ? [] : [config.metric];
}

/** The standings of a goals event keep this many of those who reached the targets. */
const MAX_STANDINGS_STORED = 200;

/** What the stored config of a row says. */
export function configOf(row: EventRow): EventConfig {
  return eventConfigSchema.parse(JSON.parse(row.config));
}

/** A row as the API shows it. */
export function toEvent(row: EventRow): CompetitionEvent {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    state: row.state,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    ...configOf(row),
    baselineAt: row.baseline_at === null ? null : iso(row.baseline_at),
    finishedAt: row.finished_at === null ? null : iso(row.finished_at),
    problem: row.problem,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** Ranks scores: the higher first, and of equal scores the one reached first. */
export function rank(
  scores: readonly { uuid: string; name: string; score: number; changedAt: number }[],
): Standing[] {
  return [...scores]
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.changedAt - b.changedAt ||
        (a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0),
    )
    .map(({ uuid, name, score }, index) => ({ place: index + 1, uuid, name, score }));
}

/**
 * Runs the competitions: starts them (takes the counters at the start), keeps their standings
 * (counted every five minutes), and ends them (counts once more, freezes the result, hands out
 * the rewards). Every step is written to the database before the next, so a restart of Outpost
 * goes on where it stopped.
 */
export class CompetitionEngine {
  #timer: ReturnType<typeof setInterval> | undefined;
  #ticking = false;
  /** A look was asked for while one was running: another one follows at once. */
  #again = false;
  readonly #counting = new Map<string, Promise<Standing[]>>();

  constructor(
    private readonly ctx: PluginContext,
    private readonly db: Kysely<CompetitionsTables>,
    private readonly sampler: Sampler,
    private readonly directory: PlayerDirectory,
    /**
     * Called after every look, with the servers whose players are worth watching: those with a
     * running competition or with rewards still waiting for their winners.
     */
    private readonly onTicked: (watchedServerIds: ReadonlySet<string>) => void,
    private readonly options: EngineOptions = DEFAULT_ENGINE_OPTIONS,
  ) {}

  start(): void {
    void this.tick();
    this.#timer = setInterval(() => void this.tick(), this.options.tickMs);
  }

  stop(): void {
    clearInterval(this.#timer);
  }

  /** One look at every competition that is not over. */
  async tick(): Promise<void> {
    if (this.#ticking) {
      this.#again = true;
      return;
    }
    this.#ticking = true;
    try {
      const rows = await this.db
        .selectFrom('comp_events')
        .selectAll()
        .where('state', 'in', ['scheduled', 'active', 'finishing'])
        .execute();
      for (const row of rows) {
        try {
          await this.#announce(row);
          await this.#advance(row);
        } catch (err) {
          await this.#fail(row, err);
        }
      }
      const active = await this.db
        .selectFrom('comp_events')
        .select('server_id')
        .distinct()
        .where('state', '=', 'active')
        .execute();
      const watched = new Set(active.map(({ server_id }) => server_id));
      const recent = await this.db
        .selectFrom('comp_events')
        .select('server_id')
        .distinct()
        .where('state', '=', 'finished')
        .where('finished_at', '>', Date.now() - REWARD_WATCH_MS)
        .execute();
      for (const { server_id: serverId } of recent) {
        if (watched.has(serverId)) continue;
        const waiting = await this.ctx.playerTasks.list({
          serverId,
          kind: REWARD_KIND,
          status: 'pending',
        });
        if (waiting.length > 0) watched.add(serverId);
      }
      this.onTicked(watched);
    } catch (err) {
      this.ctx.logger.warn('looking at the competitions failed', { error: String(err) });
    } finally {
      this.#ticking = false;
      if (this.#again) {
        this.#again = false;
        void this.tick();
      }
    }
  }

  async #advance(row: EventRow): Promise<void> {
    const now = Date.now();
    if (row.state === 'scheduled') {
      if (now >= Number(row.ends_at)) {
        await this.#update(row.id, {
          state: 'cancelled',
          problem: 'missed',
        });
      } else if (now >= Number(row.starts_at)) {
        await this.#begin(row);
      }
    } else if (row.state === 'active') {
      if (now >= Number(row.ends_at)) await this.#finish(row);
      else if (
        row.counted_at === null ||
        now - Number(row.counted_at) >=
          (this.options.countIntervalMs ?? configOf(row).countEveryMinutes * 60_000)
      ) {
        await this.count(row);
        if (row.problem !== null) await this.#update(row.id, { problem: null });
      }
    } else if (row.state === 'finishing') {
      await this.#complete(row);
    }
  }

  /** Sends the announcements whose moment has come; the ones far too late are dropped. */
  async #announce(row: EventRow): Promise<void> {
    if (row.state !== 'scheduled' && row.state !== 'active') return;
    const { announcements } = configOf(row);
    if (announcements.length === 0) return;
    const sent = new Set<string>(
      row.announced === null ? [] : (JSON.parse(row.announced) as string[]),
    );
    const before = sent.size;
    const now = Date.now();
    for (const announcement of announcements) {
      const key = announcementKey(announcement);
      const moment =
        Number(announcement.anchor === 'start' ? row.starts_at : row.ends_at) -
        announcement.minutesBefore * 60_000;
      if (sent.has(key) || now < moment) continue;
      if (now - moment <= ANNOUNCE_GRACE_MS) {
        try {
          const lines = renderAnnouncement(
            toEvent(row),
            announcement.text,
            await this.standings(row),
            now,
            await this.goalViewOf(row),
          );
          if (lines.length > 0) await this.ctx.chat.broadcast(row.server_id, lines);
        } catch (err) {
          // Not sent yet (the server is not reachable): try again until it is too late.
          this.ctx.logger.debug('announcing failed', { eventId: row.id, error: String(err) });
          continue;
        }
      }
      sent.add(key);
    }
    if (sent.size !== before) {
      await this.db
        .updateTable('comp_events')
        .set({ announced: JSON.stringify([...sent]) })
        .where('id', '=', row.id)
        .execute();
    }
  }

  /** Keeps the reason a competition cannot go on, and tries again at the next look. */
  async #fail(row: EventRow, err: unknown): Promise<void> {
    const problem = err instanceof HttpError ? err.code : 'error';
    if (!(err instanceof HttpError)) {
      this.ctx.logger.warn('a competition failed', { eventId: row.id, error: String(err) });
    }
    if (row.problem !== problem) await this.#update(row.id, { problem });
  }

  async #update(id: string, changes: Partial<EventRow>): Promise<void> {
    await this.db
      .updateTable('comp_events')
      .set({ ...changes, updated_at: Date.now() })
      .where('id', '=', id)
      .execute();
  }

  /** Takes the counters of everyone at the start. */
  async #begin(row: EventRow): Promise<void> {
    const config = configOf(row);
    await this.#flush(row.server_id);
    const counters = await this.sampler.measureMany(row.server_id, row.id, metricsOf(config), {
      fresh: true,
    });
    const now = Date.now();
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('comp_baselines').where('event_id', '=', row.id).execute();
      await trx.deleteFrom('comp_target_baselines').where('event_id', '=', row.id).execute();
      if (config.scoring.kind === 'targets') {
        const targetValues = [...counters].flatMap(([uuid, totals]) =>
          totals.flatMap((value, target) =>
            value > 0 ? [{ event_id: row.id, uuid, target, value }] : [],
          ),
        );
        for (let at = 0; at < targetValues.length; at += INSERT_CHUNK) {
          await trx
            .insertInto('comp_target_baselines')
            .values(targetValues.slice(at, at + INSERT_CHUNK))
            .execute();
        }
      } else {
        const values = [...counters]
          .filter(([, totals]) => (totals[0] ?? 0) > 0)
          .map(([uuid, totals]) => ({ event_id: row.id, uuid, value: totals[0] ?? 0 }));
        for (let at = 0; at < values.length; at += INSERT_CHUNK) {
          await trx
            .insertInto('comp_baselines')
            .values(values.slice(at, at + INSERT_CHUNK))
            .execute();
        }
      }
      await trx
        .updateTable('comp_events')
        .set({
          state: 'active',
          baseline_at: now,
          counted_at: null,
          problem: null,
          updated_at: now,
        })
        .where('id', '=', row.id)
        .execute();
    });
    await this.count({ ...row, state: 'active', baseline_at: now });
  }

  /**
   * Counts the standings and keeps them for the chat command and the page. `fresh` reads every
   * file again, for the end. Counts of one competition never run at the same time.
   */
  count(row: EventRow, options: { fresh?: boolean } = {}): Promise<Standing[]> {
    const running = this.#counting.get(row.id);
    if (running !== undefined && options.fresh !== true) return running;
    // A fresh count waits for the one that runs, so that it reads the files after it.
    const run: Promise<Standing[]> = (running?.catch(() => []) ?? Promise.resolve([]))
      .then(() => this.#count(row, options))
      .finally(() => {
        if (this.#counting.get(row.id) === run) this.#counting.delete(row.id);
      });
    this.#counting.set(row.id, run);
    return run;
  }

  async #count(row: EventRow, options: { fresh?: boolean }): Promise<Standing[]> {
    const config = configOf(row);
    return config.scoring.kind === 'targets'
      ? this.#countGoals(row, config, options)
      : this.#countRanking(row, config, options);
  }

  async #excluded(row: EventRow, config: EventConfig): Promise<Set<string>> {
    const excluded = new Set(config.participants.excluded.map(({ uuid }) => uuid));
    if (config.participants.excludeOperators) {
      for (const uuid of await this.directory.operators(row.server_id)) excluded.add(uuid);
    }
    return excluded;
  }

  async #countRanking(
    row: EventRow,
    config: EventConfig,
    options: { fresh?: boolean },
  ): Promise<Standing[]> {
    const metric = config.metric;
    const totals =
      metric === undefined
        ? new Map<string, number[]>()
        : await this.sampler.measureMany(row.server_id, row.id, [metric], options);
    const counters = new Map([...totals].map(([uuid, values]) => [uuid, values[0] ?? 0]));
    const baselines = new Map(
      (
        await this.db
          .selectFrom('comp_baselines')
          .select(['uuid', 'value'])
          .where('event_id', '=', row.id)
          .execute()
      ).map(({ uuid, value }) => [uuid, Number(value)]),
    );
    const excluded = await this.#excluded(row, config);
    const names = await this.directory.names(row.server_id);
    const before = new Map(
      (
        await this.db.selectFrom('comp_scores').selectAll().where('event_id', '=', row.id).execute()
      ).map((score) => [score.uuid, score]),
    );

    const now = Date.now();
    const scores = [...counters].flatMap(([uuid, total]) => {
      // Scoring `sum`: what the counter grew by since the start.
      const score = total - (baselines.get(uuid) ?? 0);
      if (score <= 0 || excluded.has(uuid)) return [];
      const previous = before.get(uuid);
      const changedAt =
        previous !== undefined && Number(previous.score) === score
          ? Number(previous.changed_at)
          : now;
      return [{ uuid, name: names.get(uuid) ?? uuid.slice(0, 8), score, changedAt }];
    });
    const standings = rank(scores);
    const changedAt = new Map(scores.map(({ uuid, changedAt: at }) => [uuid, at]));

    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('comp_scores').where('event_id', '=', row.id).execute();
      const values = standings.map(({ uuid, name, score }) => ({
        event_id: row.id,
        uuid,
        name,
        score,
        changed_at: changedAt.get(uuid) ?? now,
      }));
      for (let at = 0; at < values.length; at += INSERT_CHUNK) {
        await trx
          .insertInto('comp_scores')
          .values(values.slice(at, at + INSERT_CHUNK))
          .execute();
      }
      await trx
        .updateTable('comp_events')
        .set({ counted_at: now })
        .where('id', '=', row.id)
        .execute();
    });
    return standings;
  }

  /**
   * Goals: how far every player is on every target since the start; those who have reached all of
   * them for the first time are recorded, rewarded and announced.
   */
  async #countGoals(
    row: EventRow,
    config: EventConfig,
    options: { fresh?: boolean },
  ): Promise<Standing[]> {
    if (config.scoring.kind !== 'targets') return [];
    const { targets } = config.scoring;
    const totals = await this.sampler.measureMany(
      row.server_id,
      row.id,
      metricsOf(config),
      options,
    );
    const baselines = new Map(
      (
        await this.db
          .selectFrom('comp_target_baselines')
          .select(['uuid', 'target', 'value'])
          .where('event_id', '=', row.id)
          .execute()
      ).map(({ uuid, target, value }) => [`${uuid}:${Number(target)}`, Number(value)]),
    );
    const excluded = await this.#excluded(row, config);
    const names = await this.directory.names(row.server_id);
    const completed = new Map(
      (
        await this.db
          .selectFrom('comp_completions')
          .selectAll()
          .where('event_id', '=', row.id)
          .execute()
      ).map((completion) => [completion.uuid, completion]),
    );

    const now = Date.now();
    const progress: CompetitionsTables['comp_progress'][] = [];
    const reached: { uuid: string; name: string }[] = [];
    for (const [uuid, values] of totals) {
      if (excluded.has(uuid)) continue;
      const grown = targets.map((_, index) =>
        Math.max(0, (values[index] ?? 0) - (baselines.get(`${uuid}:${index}`) ?? 0)),
      );
      if (grown.every((value) => value === 0)) continue;
      const name = names.get(uuid) ?? uuid.slice(0, 8);
      grown.forEach((value, target) =>
        progress.push({ event_id: row.id, uuid, target, name, value }),
      );
      if (
        !completed.has(uuid) &&
        targets.every((target, index) => (grown[index] ?? 0) >= target.amount)
      ) {
        reached.push({ uuid, name });
      }
    }
    // Those who reached the goals at this count are ordered by name: the files cannot tell more.
    reached.sort((a, b) => a.name.localeCompare(b.name) || (a.uuid < b.uuid ? -1 : 1));
    const fresh = reached.map((player, index) => ({
      event_id: row.id,
      uuid: player.uuid,
      name: player.name,
      place: completed.size + index + 1,
      completed_at: now,
    }));

    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('comp_progress').where('event_id', '=', row.id).execute();
      for (let at = 0; at < progress.length; at += INSERT_CHUNK) {
        await trx
          .insertInto('comp_progress')
          .values(progress.slice(at, at + INSERT_CHUNK))
          .execute();
      }
      for (let at = 0; at < fresh.length; at += INSERT_CHUNK) {
        await trx
          .insertInto('comp_completions')
          .values(fresh.slice(at, at + INSERT_CHUNK))
          .execute();
      }
      await trx
        .updateTable('comp_events')
        .set({ counted_at: now })
        .where('id', '=', row.id)
        .execute();
    });

    const standings = await this.standings(row, MAX_STANDINGS_STORED);
    if (fresh.length > 0) {
      await this.#enqueueRewards(row, config, standings, () => config.rewards.places[0]);
      await this.#announceCompletions(row, config, fresh, completed.size + fresh.length);
    }
    return standings;
  }

  /** Tells everyone who has just reached the goals. */
  async #announceCompletions(
    row: EventRow,
    config: EventConfig,
    fresh: readonly { name: string; place: number }[],
    completed: number,
  ): Promise<void> {
    if (!config.messages.announceCompletions) return;
    for (const player of fresh) {
      try {
        const lines = renderCompletion(
          { name: row.name, messages: config.messages },
          player.name,
          player.place,
          completed,
        );
        if (lines.length > 0) await this.ctx.chat.broadcast(row.server_id, lines);
      } catch (err) {
        this.ctx.logger.debug('announcing a completion failed', { error: String(err) });
      }
    }
  }

  /** Goals: the players with progress, those who have reached all the targets first. */
  async #progressRows(row: EventRow, config: EventConfig): Promise<ProgressRow[]> {
    if (config.scoring.kind !== 'targets') return [];
    const { targets } = config.scoring;
    const stored = await this.db
      .selectFrom('comp_progress')
      .selectAll()
      .where('event_id', '=', row.id)
      .execute();
    const completions = new Map(
      (
        await this.db
          .selectFrom('comp_completions')
          .selectAll()
          .where('event_id', '=', row.id)
          .execute()
      ).map((completion) => [completion.uuid, completion]),
    );
    const byPlayer = new Map<string, ProgressRow>();
    const row_ = (uuid: string, name: string): ProgressRow => {
      const known = byPlayer.get(uuid);
      if (known !== undefined) return known;
      const completion = completions.get(uuid);
      const created: ProgressRow = {
        uuid,
        name,
        done: completion !== undefined,
        place: completion === undefined ? null : Number(completion.place),
        completedAt: completion === undefined ? null : iso(completion.completed_at),
        targets: targets.map((target) => ({
          label: target.label,
          value: 0,
          amount: target.amount,
        })),
      };
      byPlayer.set(uuid, created);
      return created;
    };
    for (const entry of stored) {
      const target = row_(entry.uuid, entry.name).targets[Number(entry.target)];
      if (target !== undefined) target.value = Number(entry.value);
    }
    // Someone who reached the targets stays on the list, even when they are excluded now.
    for (const completion of completions.values()) row_(completion.uuid, completion.name);
    const fraction = (progress: ProgressRow) =>
      progress.targets.reduce((sum, target) => sum + Math.min(target.value / target.amount, 1), 0) /
      Math.max(progress.targets.length, 1);
    return [...byPlayer.values()].sort(
      (a, b) =>
        Number(b.done) - Number(a.done) ||
        (a.place ?? 0) - (b.place ?? 0) ||
        fraction(b) - fraction(a) ||
        a.name.localeCompare(b.name),
    );
  }

  /** Goals: the players with progress and how many reached all the targets. */
  async progress(row: EventRow, limit = 25): Promise<{ rows: ProgressRow[]; completed: number }> {
    const rows = await this.#progressRows(row, configOf(row));
    return { rows: rows.slice(0, limit), completed: rows.filter(({ done }) => done).length };
  }

  /** What the texts of a goals event say about a player; undefined for other events. */
  async goalViewOf(row: EventRow, viewer?: string): Promise<GoalView | undefined> {
    const config = configOf(row);
    if (config.scoring.kind !== 'targets') return undefined;
    const rows = await this.#progressRows(row, config);
    const own =
      viewer === undefined
        ? undefined
        : rows.find((entry) => entry.name.toLowerCase() === viewer.toLowerCase());
    return goalView(config.scoring.targets, own, rows.filter(({ done }) => done).length);
  }

  /** The standings of the last count, or the frozen ones of a competition that is over. */
  async standings(row: EventRow, limit = 25): Promise<Standing[]> {
    if (row.results !== null) return resultsSchema.parse(JSON.parse(row.results)).slice(0, limit);
    const config = configOf(row);
    if (config.scoring.kind === 'targets') {
      // Goals: those who reached all the targets, in order.
      const completions = await this.db
        .selectFrom('comp_completions')
        .selectAll()
        .where('event_id', '=', row.id)
        .orderBy('place')
        .limit(limit)
        .execute();
      return completions.map((completion) => ({
        place: Number(completion.place),
        uuid: completion.uuid,
        name: completion.name,
        score: config.scoring.kind === 'targets' ? config.scoring.targets.length : 0,
      }));
    }
    const scores = await this.db
      .selectFrom('comp_scores')
      .selectAll()
      .where('event_id', '=', row.id)
      .execute();
    return rank(
      scores.map((score) => ({
        uuid: score.uuid,
        name: score.name,
        score: Number(score.score),
        changedAt: Number(score.changed_at),
      })),
    ).slice(0, limit);
  }

  /** The end: counts once more from fresh files and freezes the result. */
  async #finish(row: EventRow): Promise<void> {
    const config = configOf(row);
    await this.#flush(row.server_id);
    const counted = await this.count(row, { fresh: true });
    const standings =
      config.scoring.kind === 'targets' ? counted : counted.slice(0, config.participants.top);
    await this.#update(row.id, {
      state: 'finishing',
      results: JSON.stringify(standings),
      problem: null,
    });
    await this.#complete({ ...row, state: 'finishing', results: JSON.stringify(standings) });
  }

  /** Hands out the rewards, tells everyone and closes a competition whose result is frozen. */
  async #complete(row: EventRow): Promise<void> {
    if (row.results === null) {
      // Cannot happen; a competition without a result has nothing to hand out.
      await this.#update(row.id, { state: 'finished', finished_at: Date.now() });
      return;
    }
    const config = configOf(row);
    const standings = resultsSchema.parse(JSON.parse(row.results));
    await this.#enqueueRewards(row, config, standings, (standing) =>
      config.scoring.kind === 'targets'
        ? config.rewards.places[0]
        : config.rewards.places.find(({ place }) => place === standing.place),
    );
    const now = Date.now();
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('comp_baselines').where('event_id', '=', row.id).execute();
      await trx.deleteFrom('comp_target_baselines').where('event_id', '=', row.id).execute();
      await trx
        .updateTable('comp_events')
        .set({ state: 'finished', finished_at: now, problem: null, updated_at: now })
        .where('id', '=', row.id)
        .execute();
    });
    this.sampler.forget(row.id);
    if (config.messages.announceResults) {
      const event = { ...toEvent({ ...row, state: 'finished' }) };
      try {
        const lines = renderResults(event, standings, now, await this.goalViewOf(row));
        if (lines.length > 0) await this.ctx.chat.broadcast(row.server_id, lines);
      } catch (err) {
        this.ctx.logger.debug('announcing the results failed', { error: String(err) });
      }
    }
  }

  /** One task per command of a place, once: tasks that exist already are left alone. */
  async #enqueueRewards(
    row: EventRow,
    config: EventConfig,
    standings: readonly Standing[],
    rewardOf: (standing: Standing) => Rewards['places'][number] | undefined,
  ): Promise<void> {
    const existing = new Set(
      (await this.ctx.playerTasks.list({ serverId: row.server_id, kind: REWARD_KIND }))
        .map((task) => rewardPayloadSchema.safeParse(task.payload))
        .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
        .filter((payload) => payload.eventId === row.id)
        .map((payload) => `${payload.place}:${payload.index}`),
    );
    for (const standing of standings) {
      const reward = rewardOf(standing);
      if (reward === undefined) continue;
      for (const [index, command] of reward.commands.entries()) {
        if (existing.has(`${standing.place}:${index}`)) continue;
        const payload: RewardPayload = {
          eventId: row.id,
          eventName: row.name,
          place: standing.place,
          score: standing.score,
          index,
          command,
          message: index === 0 ? config.messages.reward : null,
        };
        await this.ctx.playerTasks.enqueue({
          serverId: row.server_id,
          playerUuid: standing.uuid,
          playerName: standing.name,
          kind: REWARD_KIND,
          payload,
        });
      }
    }
  }

  async #flush(serverId: string): Promise<void> {
    try {
      await this.ctx.stats.flush(serverId);
    } catch (err) {
      // Without a flush the counters lag by a few minutes; that is better than no result.
      this.ctx.logger.debug('saving the world failed', { serverId, error: String(err) });
    }
  }

  // --- What the routes do -----------------------------------------------------------------------

  async create(
    serverId: string,
    userId: string,
    input: {
      name: string;
      timezone: string;
      startsAt: number;
      endsAt: number;
      config: EventConfig;
    },
  ): Promise<EventRow> {
    const now = Date.now();
    const row: EventRow = {
      id: crypto.randomUUID(),
      server_id: serverId,
      name: input.name,
      timezone: input.timezone,
      state: 'scheduled',
      starts_at: Math.max(input.startsAt, now),
      ends_at: input.endsAt,
      config: JSON.stringify(input.config),
      baseline_at: null,
      counted_at: null,
      results: null,
      finished_at: null,
      problem: null,
      announced: null,
      created_by: userId,
      created_at: now,
      updated_at: now,
    };
    await this.db.insertInto('comp_events').values(row).execute();
    void this.tick();
    return row;
  }

  /**
   * Counts the standings now from fresh files: the server saves the world first, which can make
   * it hiccup for a moment, so this is for people to ask for, not for the engine to do.
   */
  async recount(row: EventRow): Promise<Standing[]> {
    await this.#flush(row.server_id);
    return this.count(row, { fresh: true });
  }

  /** Whether a competition in this state can be changed, and which part. */
  static editable(state: EventState): 'all' | 'running' | null {
    if (state === 'scheduled') return 'all';
    if (state === 'active') return 'running';
    return null;
  }

  async cancel(row: EventRow): Promise<void> {
    await this.#update(row.id, { state: 'cancelled', problem: null });
    this.sampler.forget(row.id);
  }

  async remove(row: EventRow): Promise<void> {
    // Rewards that were not given yet are not given for a competition that is gone.
    const tasks = await this.ctx.playerTasks.list({
      serverId: row.server_id,
      kind: REWARD_KIND,
      status: 'pending',
    });
    for (const task of tasks) {
      if (rewardPayloadSchema.safeParse(task.payload).data?.eventId === row.id) {
        await this.ctx.playerTasks.cancel(task.id);
      }
    }
    await this.db.deleteFrom('comp_events').where('id', '=', row.id).execute();
    this.sampler.forget(row.id);
  }
}
