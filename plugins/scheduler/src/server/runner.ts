import { HttpError, type Kysely, type PluginContext } from '@outpost/plugin-api';
import { parsePlayerList, stripFormatting } from '@outpost/shared';
import { Cron } from 'croner';
import { announcementCommand, RUNS_KEPT, type Run } from '../shared.js';
import type { RunStatus, RunTrigger, SchedulerTables } from './tables.js';

export type TaskRow = SchedulerTables['sched_tasks'];
type RunRow = SchedulerTables['sched_runs'];

interface Outcome {
  status: RunStatus;
  reason: string | null;
  output: string | null;
}

/** Longest output kept per run. */
const OUTPUT_LIMIT = 4000;

const iso = (time: number) => new Date(Number(time)).toISOString();

export function toRun(row: RunRow): Run {
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    reason: row.reason,
    output: row.output,
    triggeredBy: row.triggered_by,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  };
}

/**
 * Runs the tasks on their schedules. Runs missed while Outpost was down are not made up for, and
 * a run is skipped while the run before of the same task is still going.
 */
export class TaskRunner {
  readonly #ctx: PluginContext;
  readonly #db: Kysely<SchedulerTables>;
  readonly #jobs = new Map<string, Cron>();
  readonly #running = new Set<string>();

  constructor(ctx: PluginContext, db: Kysely<SchedulerTables>) {
    this.#ctx = ctx;
    this.#db = db;
  }

  async start(): Promise<void> {
    const tasks = await this.#db
      .selectFrom('sched_tasks')
      .selectAll()
      .where('enabled', '=', 1)
      .execute();
    for (const task of tasks) this.schedule(task);
  }

  /** Schedules a task anew after it was created or changed; a disabled task is only stopped. */
  schedule(task: TaskRow): void {
    this.unschedule(task.id);
    if (task.enabled !== 1) return;
    const job = new Cron(task.cron, { mode: '5-part', timezone: task.timezone }, () => {
      this.run(task.id, 'schedule', null).catch((err: unknown) => {
        this.#ctx.logger.error('A scheduled task failed', { taskId: task.id, error: String(err) });
      });
    });
    this.#jobs.set(task.id, job);
  }

  unschedule(taskId: string): void {
    this.#jobs.get(taskId)?.stop();
    this.#jobs.delete(taskId);
  }

  nextRun(taskId: string): Date | null {
    return this.#jobs.get(taskId)?.nextRun() ?? null;
  }

  stop(): void {
    for (const job of this.#jobs.values()) job.stop();
    this.#jobs.clear();
  }

  /** Runs a task and records the run; null when the task no longer exists. */
  async run(taskId: string, trigger: RunTrigger, user: string | null): Promise<Run | null> {
    const task = await this.#db
      .selectFrom('sched_tasks')
      .selectAll()
      .where('id', '=', taskId)
      .executeTakeFirst();
    if (task === undefined) {
      // Deleted, possibly together with its server.
      this.unschedule(taskId);
      return null;
    }
    const startedAt = Date.now();
    if (this.#running.has(taskId)) {
      return this.#record(task, trigger, user, startedAt, {
        status: 'skipped',
        reason: 'still_running',
        output: null,
      });
    }
    this.#running.add(taskId);
    try {
      return await this.#record(task, trigger, user, startedAt, await this.#execute(task));
    } finally {
      this.#running.delete(taskId);
    }
  }

  async #execute(task: TaskRow): Promise<Outcome> {
    const send = (command: string) => this.#ctx.commands.send(task.server_id, command);
    const lines = JSON.parse(task.lines) as string[];
    const output: string[] = [];
    let sent = 0;
    try {
      if (task.only_with_players === 1) {
        const list = parsePlayerList(await send('list'));
        if (list !== null && list.online === 0) {
          return { status: 'skipped', reason: 'no_players', output: null };
        }
      }
      if (task.type === 'announcement') {
        const index = Number(task.next_index) % lines.length;
        const message = lines[index] ?? '';
        await send(announcementCommand(message));
        await this.#db
          .updateTable('sched_tasks')
          .set({ next_index: (index + 1) % lines.length })
          .where('id', '=', task.id)
          .execute();
        return { status: 'ok', reason: null, output: message };
      }
      for (const command of lines) {
        const reply = stripFormatting(await send(command)).trim();
        sent++;
        output.push(`> ${command}`, ...(reply === '' ? [] : [reply]));
      }
      return { status: 'ok', reason: null, output: output.join('\n') };
    } catch (err) {
      if (!(err instanceof HttpError)) {
        this.#ctx.logger.error('A task failed', { taskId: task.id, error: String(err) });
        return { status: 'failed', reason: 'error', output: output.join('\n') || null };
      }
      const reason = err.statusCode === 409 ? 'not_connected' : err.code;
      // The server could not be reached before anything was done.
      if (sent === 0) return { status: 'skipped', reason, output: null };
      return { status: 'failed', reason, output: output.join('\n') };
    }
  }

  async #record(
    task: TaskRow,
    trigger: RunTrigger,
    user: string | null,
    startedAt: number,
    outcome: Outcome,
  ): Promise<Run> {
    const row: RunRow = {
      id: crypto.randomUUID(),
      task_id: task.id,
      trigger,
      status: outcome.status,
      reason: outcome.reason,
      output: outcome.output === null ? null : outcome.output.slice(0, OUTPUT_LIMIT),
      triggered_by: user,
      started_at: startedAt,
      finished_at: Date.now(),
    };
    await this.#db.insertInto('sched_runs').values(row).execute();
    await this.#db
      .deleteFrom('sched_runs')
      .where('task_id', '=', task.id)
      .where(
        'id',
        'not in',
        this.#db
          .selectFrom('sched_runs')
          .select('id')
          .where('task_id', '=', task.id)
          .orderBy('started_at', 'desc')
          .limit(RUNS_KEPT),
      )
      .execute();
    return toRun(row);
  }
}
