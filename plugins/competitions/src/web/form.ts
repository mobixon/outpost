import { instantToZoned, zonedToInstant } from '@outpost/shared';
import {
  eventInputSchema,
  DEFAULT_COUNT_MINUTES,
  announcementKey,
  defaultAnnouncements,
  defaultGoalMessages,
  defaultMessages,
  isValidBlockPattern,
  MAX_NAME_LENGTH,
  MAX_TOP,
  normalizeBlockPattern,
  statPresetsOf,
  type Announcement,
  type BlockPreset,
  type CompetitionEvent,
  type EventInput,
  type Messages,
  type Metric,
  type PlayerRef,
  type StatCategory,
  type StatPreset,
} from '../shared.js';

/** Lengths to pick for a competition, in minutes. */
export const PERIODS = [
  { key: 'tenMinutes', minutes: 10 },
  { key: 'thirtyMinutes', minutes: 30 },
  { key: 'twoDays', minutes: 2 * 24 * 60 },
  { key: 'week', minutes: 7 * 24 * 60 },
  { key: 'twoWeeks', minutes: 14 * 24 * 60 },
] as const;

/** How often the standings can be counted, in minutes. */
export const COUNT_EVERY_CHOICES = [1, 2, 5, 10, 15, 30, 60] as const;

/** What is counted, as the editor keeps it: the choices for every kind stay while it is open. */
export interface MetricForm {
  kind: Metric['kind'];
  presets: BlockPreset[];
  /** One block id or pattern per line or comma. */
  blocks: string;
  category: StatCategory;
  statPresets: StatPreset[];
  /** One id or pattern per line or comma. */
  ids: string;
}

/** One goal: reach an amount of a counter. */
export interface TargetForm {
  label: string;
  metric: MetricForm;
  amount: number;
}

/** What the editor keeps while it is open; times are what a clock in `timezone` shows. */
export interface EditorForm {
  name: string;
  timezone: string;
  /** `2026-09-28T18:00` */
  start: string;
  end: string;
  /** A top of players, or goals for everyone. */
  mode: 'ranking' | 'goals';
  /** What a top counts. */
  metric: MetricForm;
  /** What the goals ask for. */
  targets: TargetForm[];
  top: number;
  excludeOperators: boolean;
  excluded: PlayerRef[];
  /** The commands of every place, one per line; index 0 is the first place, or all goals. */
  rewards: string[];
  messages: Messages;
  countEveryMinutes: number;
  announcements: Announcement[];
}

export function emptyMetricForm(): MetricForm {
  return {
    kind: 'mined',
    presets: ['wood'],
    blocks: '',
    category: 'picked_up',
    statPresets: [],
    ids: '',
  };
}

export function emptyTarget(): TargetForm {
  return { label: '', metric: { ...emptyMetricForm(), presets: [] }, amount: 20 };
}

/** The form of a metric that was saved. */
export function metricFormOf(metric: Metric | undefined): MetricForm {
  const form = emptyMetricForm();
  if (metric === undefined) return form;
  form.kind = metric.kind;
  if (metric.kind === 'mined') {
    form.presets = [...metric.presets];
    form.blocks = metric.blocks.join('\n');
  } else if (metric.kind === 'stat') {
    form.category = metric.category;
    form.statPresets = [...metric.presets];
    form.ids = metric.ids.join('\n');
  } else {
    form.presets = [];
  }
  return form;
}

/** The metric the form describes. */
export function toMetric(form: MetricForm): Metric {
  if (form.kind === 'fish_caught') return { kind: 'fish_caught' };
  if (form.kind === 'stat') {
    return {
      kind: 'stat',
      category: form.category,
      // Presets of another category are left over from a category picked before.
      presets: form.statPresets.filter((preset) => statPresetsOf(form.category).includes(preset)),
      ids: parseBlocks(form.ids),
    };
  }
  return { kind: 'mined', presets: form.presets, blocks: parseBlocks(form.blocks) };
}

/** Whether a metric of the form says what it counts, with ids that can be ids. */
export function metricFormProblems(form: MetricForm): ('metric' | 'blocks')[] {
  const metric = toMetric(form);
  if (metric.kind === 'fish_caught') return [];
  const ids = metric.kind === 'mined' ? metric.blocks : metric.ids;
  const problems: ('metric' | 'blocks')[] = [];
  if (metric.presets.length === 0 && ids.length === 0) problems.push('metric');
  if (!ids.every(isValidBlockPattern)) problems.push('blocks');
  return problems;
}

const MINUTE_MS = 60_000;

export function emptyForm(timezone: string, now = Date.now()): EditorForm {
  // The next full minute: a start in the past would begin at once anyway.
  const start = Math.ceil(now / 60_000) * 60_000;
  return {
    name: '',
    timezone,
    start: instantToZoned(start, timezone),
    end: instantToZoned(start + PERIODS[3].minutes * MINUTE_MS, timezone),
    mode: 'ranking',
    metric: emptyMetricForm(),
    targets: [emptyTarget()],
    top: 3,
    excludeOperators: true,
    excluded: [],
    rewards: Array.from({ length: MAX_TOP }, () => ''),
    messages: defaultMessages(),
    countEveryMinutes: DEFAULT_COUNT_MINUTES,
    announcements: defaultAnnouncements(),
  };
}

/** What makes an event, as the editor and the JSON view see it. */
type EventParts = Pick<
  CompetitionEvent,
  | 'name'
  | 'timezone'
  | 'startsAt'
  | 'endsAt'
  | 'metric'
  | 'scoring'
  | 'participants'
  | 'rewards'
  | 'messages'
  | 'countEveryMinutes'
  | 'announcements'
>;

export function fromEvent(event: EventParts): EditorForm {
  const rewards = Array.from({ length: MAX_TOP }, () => '');
  for (const reward of event.rewards.places) {
    rewards[reward.place - 1] = reward.commands.join('\n');
  }
  const goals = event.scoring.kind === 'targets';
  return {
    name: event.name,
    timezone: event.timezone,
    start: instantToZoned(Date.parse(event.startsAt), event.timezone),
    end: instantToZoned(Date.parse(event.endsAt), event.timezone),
    mode: goals ? 'goals' : 'ranking',
    metric: metricFormOf(event.metric),
    targets:
      event.scoring.kind === 'targets'
        ? event.scoring.targets.map((target) => ({
            label: target.label,
            metric: metricFormOf(target.metric),
            amount: target.amount,
          }))
        : [emptyTarget()],
    top: event.participants.top,
    excludeOperators: event.participants.excludeOperators,
    excluded: event.participants.excluded.map(({ uuid, name }) => ({ uuid, name })),
    rewards,
    messages: { ...event.messages },
    countEveryMinutes: event.countEveryMinutes,
    announcements: event.announcements.map((announcement) => ({ ...announcement })),
  };
}

/** The form of a new event that starts like an existing one, from the next minute on. */
export function cloneForm(event: CompetitionEvent, now = Date.now()): EditorForm {
  const form = fromEvent(event);
  const length = Date.parse(event.endsAt) - Date.parse(event.startsAt);
  const start = Math.ceil(now / MINUTE_MS) * MINUTE_MS;
  form.name = `${event.name} (copy)`.slice(0, MAX_NAME_LENGTH);
  form.start = instantToZoned(start, event.timezone);
  form.end = instantToZoned(start + length, event.timezone);
  return form;
}

/** Moves the times to another time zone without changing the moments they stand for. */
export function changeTimezone(form: EditorForm, timezone: string): void {
  const start = zonedToInstant(form.start, form.timezone);
  const end = zonedToInstant(form.end, form.timezone);
  form.timezone = timezone;
  if (!Number.isNaN(start)) form.start = instantToZoned(start, timezone);
  if (!Number.isNaN(end)) form.end = instantToZoned(end, timezone);
}

/** Ends the competition a period after its start. */
export function applyPeriod(form: EditorForm, minutes: number): void {
  const start = zonedToInstant(form.start, form.timezone);
  if (!Number.isNaN(start)) form.end = instantToZoned(start + minutes * MINUTE_MS, form.timezone);
}

/** The block ids or patterns typed in, lowercase and with their namespace. */
export function parseBlocks(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map(normalizeBlockPattern)
        .filter((entry) => entry !== ''),
    ),
  ];
}

export function parseCommands(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim().replace(/^\/+/, '').trim())
    .filter((line) => line !== '');
}

/**
 * Changes between a top and goals. The texts follow, unless they were changed: a goals event asks
 * `!goal` and shows progress, a top asks `!top` and shows places.
 */
export function switchMode(form: EditorForm, mode: EditorForm['mode']): void {
  if (form.mode === mode) return;
  const of = (kind: EditorForm['mode']) =>
    JSON.stringify({
      ...(kind === 'goals' ? defaultGoalMessages() : defaultMessages()),
      description: form.messages.description,
    });
  if (JSON.stringify(form.messages) === of(form.mode)) {
    form.messages = JSON.parse(of(mode)) as Messages;
  }
  form.mode = mode;
}

/** What is wrong with the form that the editor can tell without the server; empty when nothing. */
export function problemsOf(form: EditorForm): string[] {
  const problems: string[] = [];
  if (form.name.trim() === '') problems.push('name');
  const start = zonedToInstant(form.start, form.timezone);
  const end = zonedToInstant(form.end, form.timezone);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) problems.push('period');
  const moments = new Set<string>();
  for (const announcement of form.announcements) {
    const key = announcementKey(announcement);
    if (announcement.text.trim() === '' || moments.has(key)) {
      problems.push('announcements');
      break;
    }
    moments.add(key);
  }
  if (form.mode === 'ranking') {
    problems.push(...metricFormProblems(form.metric));
  } else if (
    form.targets.length === 0 ||
    form.targets.some(
      (target) =>
        target.label.trim() === '' ||
        !/^[^\r\n&{}]+$/.test(target.label.trim()) ||
        !Number.isInteger(target.amount) ||
        target.amount < 1 ||
        metricFormProblems(target.metric).length > 0,
    )
  ) {
    problems.push('targets');
  }
  return problems;
}

/** The request body for the API; null when the times are not valid. */
export function toInput(form: EditorForm): EventInput | null {
  const start = zonedToInstant(form.start, form.timezone);
  const end = zonedToInstant(form.end, form.timezone);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const goals = form.mode === 'goals';
  const places = form.rewards
    .slice(0, goals ? 1 : form.top)
    .map((text, index) => ({ place: index + 1, commands: parseCommands(text) }))
    .filter((reward) => reward.commands.length > 0);
  return {
    name: form.name.trim(),
    timezone: form.timezone.trim(),
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
    ...(!goals && { metric: toMetric(form.metric) }),
    scoring: goals
      ? {
          kind: 'targets',
          targets: form.targets.map((target) => ({
            label: target.label.trim(),
            metric: toMetric(target.metric),
            amount: target.amount,
          })),
        }
      : { kind: 'sum' },
    participants: {
      top: form.top,
      excludeOperators: form.excludeOperators,
      excluded: form.excluded,
    },
    rewards: { places },
    messages: { ...form.messages, command: form.messages.command.trim() },
    countEveryMinutes: form.countEveryMinutes,
    announcements: form.announcements.map((announcement) => ({
      ...announcement,
      text: announcement.text.trim(),
    })),
  };
}

/** An event as the request body of the API shows it: what to copy to make the same event. */
export function inputOf(event: EventParts): EventInput {
  return {
    name: event.name,
    timezone: event.timezone,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    ...(event.scoring.kind === 'sum' && event.metric !== undefined && { metric: event.metric }),
    scoring: event.scoring,
    participants: event.participants,
    rewards: {
      places: event.rewards.places.map((reward) => ({
        place: reward.place,
        commands: [...reward.commands],
      })),
    },
    messages: event.messages,
    countEveryMinutes: event.countEveryMinutes,
    announcements: event.announcements,
  };
}

/** The keys of an event in JSON; others are ignored. */
const JSON_KEYS = [
  'name',
  'timezone',
  'startsAt',
  'endsAt',
  'metric',
  'scoring',
  'participants',
  'rewards',
  'messages',
  'countEveryMinutes',
  'announcements',
] as const;

export type JsonResult =
  { ok: true; form: EditorForm; ignored: string[] } | { ok: false; errors: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The most problems shown of a JSON that does not fit. */
const MAX_JSON_ERRORS = 8;

/**
 * Reads an event from JSON pasted or edited by hand. What the JSON leaves out keeps its value from
 * `current`, one level down for the texts, participants and rewards: a small piece of JSON changes
 * only what it says.
 */
export function formFromJson(text: string, current: EditorForm): JsonResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`Not valid JSON: ${err instanceof Error ? err.message : err}`] };
  }
  if (!isRecord(raw)) return { ok: false, errors: ['The JSON must be an object {…}'] };
  const base = toInput(current);
  if (base === null) return { ok: false, errors: ['The times of the form are not valid'] };
  const nested = (key: 'messages' | 'participants') => ({
    ...base[key],
    ...(isRecord(raw[key]) ? raw[key] : {}),
  });
  const merged = {
    ...base,
    ...raw,
    messages: nested('messages'),
    participants: nested('participants'),
  };
  const parsed = eventInputSchema.safeParse(merged);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues
        .slice(0, MAX_JSON_ERRORS)
        .map((issue) => `${issue.path.join('.') || '(event)'}: ${issue.message}`),
    };
  }
  const ignored = Object.keys(raw).filter((key) => !(JSON_KEYS as readonly string[]).includes(key));
  return { ok: true, form: fromEvent(parsed.data), ignored };
}
