import { Cron } from 'croner';
import { z } from 'zod';
import { TASK_TYPES, type TaskType } from './constants.js';

export * from './constants.js';

/** The most lines (commands or messages) of one task. */
export const MAX_TASK_LINES = 20;
/** Minecraft reads RCON requests with at most 1446 bytes of command. */
export const MAX_COMMAND_BYTES = 1446;
export const MAX_MESSAGE_LENGTH = 256;
/** Runs kept per task; older ones are deleted. */
export const RUNS_KEPT = 100;

const byteLength = (text: string) => new TextEncoder().encode(text).length;

/** A job that never runs, for reading a schedule. Throws for invalid expressions. */
function schedule(cron: string, timezone?: string): Cron {
  return new Cron(cron, {
    mode: '5-part',
    paused: true,
    ...(timezone !== undefined && { timezone }),
  });
}

/** Whether the expression has the five fields minute, hour, day of month, month and day of week. */
export function isValidCron(cron: string): boolean {
  try {
    schedule(cron);
    return true;
  } catch {
    return false;
  }
}

export function isValidTimezone(timezone: string): boolean {
  try {
    return Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone !== '';
  } catch {
    return false;
  }
}

/** The next times a schedule fires, with the expression read in the given time zone. */
export function nextRuns(cron: string, timezone: string, count: number, from?: Date): Date[] {
  return schedule(cron, timezone).nextRuns(count, from);
}

/** Trims the lines and drops empty ones; commands also lose their leading slash. */
export function normalizeLines(type: TaskType, lines: readonly string[]): string[] {
  return lines
    .map((line) => (type === 'command' ? line.trim().replace(/^\/+/, '').trim() : line.trim()))
    .filter((line) => line !== '');
}

const COLORS: Readonly<Record<string, { name: string; hex: string }>> = {
  '0': { name: 'black', hex: '#000000' },
  '1': { name: 'dark_blue', hex: '#0000aa' },
  '2': { name: 'dark_green', hex: '#00aa00' },
  '3': { name: 'dark_aqua', hex: '#00aaaa' },
  '4': { name: 'dark_red', hex: '#aa0000' },
  '5': { name: 'dark_purple', hex: '#aa00aa' },
  '6': { name: 'gold', hex: '#ffaa00' },
  '7': { name: 'gray', hex: '#aaaaaa' },
  '8': { name: 'dark_gray', hex: '#555555' },
  '9': { name: 'blue', hex: '#5555ff' },
  a: { name: 'green', hex: '#55ff55' },
  b: { name: 'aqua', hex: '#55ffff' },
  c: { name: 'red', hex: '#ff5555' },
  d: { name: 'light_purple', hex: '#ff55ff' },
  e: { name: 'yellow', hex: '#ffff55' },
  f: { name: 'white', hex: '#ffffff' },
};
const FORMATS = 'lonmr';

/** A piece of an announcement with the formatting of its `&` codes. */
export interface MessagePart {
  text: string;
  /** The Minecraft color name and the color for the web. */
  color?: { name: string; hex: string };
  bold?: boolean;
  italic?: boolean;
  underlined?: boolean;
  strikethrough?: boolean;
}

/**
 * Splits a message at `&` codes the way Minecraft renders `§` codes: `&0`–`&f` colors (a color
 * also ends the other formats), `&l` bold, `&o` italic, `&n` underlined, `&m` strikethrough and
 * `&r` reset. Any other `&` is kept as text.
 */
export function parseMessage(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let style: Omit<MessagePart, 'text'> = {};
  let current = '';
  const flush = () => {
    if (current !== '') parts.push({ ...style, text: current });
    current = '';
  };
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    const code = text.charAt(index + 1).toLowerCase();
    const color = COLORS[code];
    if (char !== '&' || code === '' || (color === undefined && !FORMATS.includes(code))) {
      current += char;
      continue;
    }
    index++;
    flush();
    if (color !== undefined) style = { color };
    else if (code === 'l') style = { ...style, bold: true };
    else if (code === 'o') style = { ...style, italic: true };
    else if (code === 'n') style = { ...style, underlined: true };
    else if (code === 'm') style = { ...style, strikethrough: true };
    else style = {};
  }
  flush();
  return parts;
}

/** The `tellraw` command that shows an announcement to all players; the text is JSON-encoded. */
export function announcementCommand(message: string): string {
  const components = parseMessage(message.replace(/[\r\n]+/g, ' ')).map(
    ({ text, color, ...formats }) => ({ text, ...(color && { color: color.name }), ...formats }),
  );
  // The first element of a text array passes its style on to the others, so it stays empty.
  return `tellraw @a ${JSON.stringify(['', ...components])}`;
}

export const taskInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    type: z.enum(TASK_TYPES),
    cron: z.string().trim().min(1).max(100).refine(isValidCron, {
      error: 'Use five fields: minute, hour, day of month, month and day of week',
    }),
    timezone: z.string().trim().min(1).max(64).refine(isValidTimezone, {
      error: 'Unknown time zone',
    }),
    enabled: z.boolean(),
    /** Skip the runs while nobody is online. */
    onlyWithPlayers: z.boolean(),
    /** Commands, or the messages of an announcement (one per run, in turn). */
    lines: z.array(z.string().max(4000)).max(100),
  })
  .superRefine((task, context) => {
    const lines = normalizeLines(task.type, task.lines);
    if (lines.length === 0 || lines.length > MAX_TASK_LINES) {
      context.addIssue({
        code: 'custom',
        path: ['lines'],
        message: `Give from 1 to ${MAX_TASK_LINES} lines`,
      });
    }
    lines.forEach((line, index) => {
      const tooLong =
        task.type === 'command'
          ? byteLength(line) > MAX_COMMAND_BYTES
          : line.length > MAX_MESSAGE_LENGTH ||
            byteLength(announcementCommand(line)) > MAX_COMMAND_BYTES;
      if (tooLong) {
        context.addIssue({ code: 'custom', path: ['lines', index], message: 'Line too long' });
      }
    });
  });
export type TaskInput = z.input<typeof taskInputSchema>;

export const runSchema = z.object({
  id: z.string(),
  trigger: z.enum(['schedule', 'manual']),
  status: z.enum(['ok', 'failed', 'skipped']),
  /**
   * Why the run was skipped or failed: `no_players`, `still_running`, `not_connected`, `error` or
   * the error of the connection, such as `connection_refused`.
   */
  reason: z.string().nullable(),
  /** The commands with the replies, or the message sent; only for users who manage tasks. */
  output: z.string().nullable(),
  /** The user of a manual run. */
  triggeredBy: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string(),
});
export type Run = z.infer<typeof runSchema>;

export const taskSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(TASK_TYPES),
  cron: z.string(),
  timezone: z.string(),
  enabled: z.boolean(),
  onlyWithPlayers: z.boolean(),
  lines: z.array(z.string()),
  /** When the task runs next; null while it is disabled. */
  nextRun: z.string().nullable(),
  lastRun: runSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof taskSchema>;

export const taskListSchema = z.object({ tasks: z.array(taskSchema) });
export const runListSchema = z.object({ runs: z.array(runSchema) });
