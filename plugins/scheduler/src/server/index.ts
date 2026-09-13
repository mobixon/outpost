import {
  definePlugin,
  HttpError,
  PLUGIN_API_VERSION,
  type PluginContext,
} from '@outpost/plugin-api';
import { z } from 'zod';
import {
  normalizeLines,
  runListSchema,
  runSchema,
  RUNS_KEPT,
  SCHEDULER_PLUGIN_ID,
  SchedulerPermission,
  TASK_TYPE_PERMISSION,
  taskInputSchema,
  taskListSchema,
  taskSchema,
  type Run,
  type Task,
  type TaskType,
} from '../shared.js';
import { TaskRunner, toRun, type TaskRow } from './runner.js';
import { migrations, type SchedulerTables } from './tables.js';

export default definePlugin({
  id: SCHEDULER_PLUGIN_ID,
  version: '0.1.0',
  apiVersion: PLUGIN_API_VERSION,
  migrations,
  permissions: [
    { key: SchedulerPermission.view, roles: ['owner', 'admin', 'moderator', 'viewer'] },
    { key: SchedulerPermission.manage, roles: ['owner', 'admin'] },
  ],
  setup,
});

const taskParams = z.object({ taskId: z.string() });
const iso = (time: number) => new Date(Number(time)).toISOString();

async function setup(ctx: PluginContext): Promise<void> {
  const db = ctx.db<SchedulerTables>();
  const runner = new TaskRunner(ctx, db);
  await runner.start();
  ctx.onShutdown(() => {
    runner.stop();
  });

  async function taskOf(serverId: string, taskId: string): Promise<TaskRow> {
    const task = await db
      .selectFrom('sched_tasks')
      .selectAll()
      .where('server_id', '=', serverId)
      .where('id', '=', taskId)
      .executeTakeFirst();
    if (task === undefined) throw new HttpError(404, 'not_found', 'No such task');
    return task;
  }

  /** A task cannot do more than its author could do by hand: commands need the console. */
  function checkType(
    user: { isSuperadmin: boolean },
    permissions: ReadonlySet<string>,
    type: TaskType,
  ): void {
    if (!user.isSuperadmin && !permissions.has(TASK_TYPE_PERMISSION[type])) {
      throw new HttpError(403, 'forbidden', 'You do not have permission to do this');
    }
  }

  /** The output of commands is shown only to users who manage the tasks. */
  const visible = (run: Run, permissions: ReadonlySet<string>): Run =>
    permissions.has(SchedulerPermission.manage) ? run : { ...run, output: null };

  async function toTask(row: TaskRow, permissions: ReadonlySet<string>): Promise<Task> {
    const last = await db
      .selectFrom('sched_runs')
      .selectAll()
      .where('task_id', '=', row.id)
      .orderBy('started_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      cron: row.cron,
      timezone: row.timezone,
      enabled: row.enabled === 1,
      onlyWithPlayers: row.only_with_players === 1,
      lines: JSON.parse(row.lines) as string[],
      nextRun: runner.nextRun(row.id)?.toISOString() ?? null,
      lastRun: last === undefined ? null : visible(toRun(last), permissions),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  const auditDetails = (row: TaskRow) => ({
    type: row.type,
    cron: row.cron,
    timezone: row.timezone,
    enabled: row.enabled === 1,
    onlyWithPlayers: row.only_with_players === 1,
    lines: JSON.parse(row.lines) as unknown,
  });

  /** The columns a task gets from the editor. */
  const fromInput = (body: z.output<typeof taskInputSchema>) => ({
    name: body.name,
    type: body.type,
    cron: body.cron,
    timezone: body.timezone,
    lines: JSON.stringify(normalizeLines(body.type, body.lines)),
    enabled: body.enabled ? 1 : 0,
    only_with_players: body.onlyWithPlayers ? 1 : 0,
  });

  ctx.http.serverRoute({
    method: 'GET',
    url: '/tasks',
    permission: SchedulerPermission.view,
    schema: { response: taskListSchema },
    handler: async ({ server, permissions }) => {
      const rows = await db
        .selectFrom('sched_tasks')
        .selectAll()
        .where('server_id', '=', server.id)
        .orderBy('created_at')
        .execute();
      return { tasks: await Promise.all(rows.map((row) => toTask(row, permissions))) };
    },
  });

  ctx.http.serverRoute({
    method: 'POST',
    url: '/tasks',
    permission: SchedulerPermission.manage,
    schema: { body: taskInputSchema, response: taskSchema },
    handler: async ({ server, user, permissions, body, ip }) => {
      checkType(user, permissions, body.type);
      const now = Date.now();
      const row: TaskRow = {
        id: crypto.randomUUID(),
        server_id: server.id,
        ...fromInput(body),
        next_index: 0,
        created_by: user.id,
        created_at: now,
        updated_at: now,
      };
      await db.insertInto('sched_tasks').values(row).execute();
      runner.schedule(row);
      await ctx.audit.record({
        action: 'task_created',
        userId: user.id,
        serverId: server.id,
        target: row.name,
        ip,
        details: auditDetails(row),
      });
      return toTask(row, permissions);
    },
  });

  ctx.http.serverRoute({
    method: 'PUT',
    url: '/tasks/:taskId',
    permission: SchedulerPermission.manage,
    schema: { params: taskParams, body: taskInputSchema, response: taskSchema },
    handler: async ({ server, user, permissions, params, body, ip }) => {
      const current = await taskOf(server.id, params.taskId);
      checkType(user, permissions, current.type);
      checkType(user, permissions, body.type);
      const input = fromInput(body);
      const changes = {
        ...input,
        // Changed messages start again from the first one.
        next_index:
          input.lines === current.lines && input.type === current.type ? current.next_index : 0,
        updated_at: Date.now(),
      };
      await db.updateTable('sched_tasks').set(changes).where('id', '=', current.id).execute();
      const row: TaskRow = { ...current, ...changes };
      runner.schedule(row);
      await ctx.audit.record({
        action: 'task_updated',
        userId: user.id,
        serverId: server.id,
        target: row.name,
        ip,
        details: auditDetails(row),
      });
      return toTask(row, permissions);
    },
  });

  ctx.http.serverRoute({
    method: 'DELETE',
    url: '/tasks/:taskId',
    permission: SchedulerPermission.manage,
    schema: { params: taskParams },
    handler: async ({ server, user, permissions, params, ip }) => {
      const task = await taskOf(server.id, params.taskId);
      checkType(user, permissions, task.type);
      runner.unschedule(task.id);
      await db.deleteFrom('sched_runs').where('task_id', '=', task.id).execute();
      await db.deleteFrom('sched_tasks').where('id', '=', task.id).execute();
      await ctx.audit.record({
        action: 'task_deleted',
        userId: user.id,
        serverId: server.id,
        target: task.name,
        ip,
        details: auditDetails(task),
      });
      return { deleted: true };
    },
  });

  ctx.http.serverRoute({
    method: 'POST',
    url: '/tasks/:taskId/run',
    permission: SchedulerPermission.manage,
    capability: 'commands.send',
    schema: { params: taskParams, response: runSchema },
    handler: async ({ server, user, permissions, params, ip }) => {
      const task = await taskOf(server.id, params.taskId);
      checkType(user, permissions, task.type);
      const run = await runner.run(task.id, 'manual', user.username);
      if (run === null) throw new HttpError(404, 'not_found', 'No such task');
      await ctx.audit.record({
        action: 'task_run',
        userId: user.id,
        serverId: server.id,
        target: task.name,
        ip,
        details: { status: run.status, reason: run.reason },
      });
      return run;
    },
  });

  ctx.http.serverRoute({
    method: 'GET',
    url: '/tasks/:taskId/runs',
    permission: SchedulerPermission.view,
    schema: { params: taskParams, response: runListSchema },
    handler: async ({ server, permissions, params }) => {
      const task = await taskOf(server.id, params.taskId);
      const rows = await db
        .selectFrom('sched_runs')
        .selectAll()
        .where('task_id', '=', task.id)
        .orderBy('started_at', 'desc')
        .limit(RUNS_KEPT)
        .execute();
      return { runs: rows.map((row) => visible(toRun(row), permissions)) };
    },
  });
}
