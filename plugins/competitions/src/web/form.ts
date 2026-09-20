import { instantToZoned, zonedToInstant } from '@outpost/shared';
import {
  DEFAULT_COUNT_MINUTES,
  announcementKey,
  defaultAnnouncements,
  defaultMessages,
  isValidBlockPattern,
  MAX_NAME_LENGTH,
  MAX_TOP,
  normalizeBlockPattern,
  type Announcement,
  type BlockPreset,
  type CompetitionEvent,
  type EventInput,
  type Messages,
  type Metric,
  type PlayerRef,
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

/** What the editor keeps while it is open; times are what a clock in `timezone` shows. */
export interface EditorForm {
  name: string;
  timezone: string;
  /** `2026-09-28T18:00` */
  start: string;
  end: string;
  /** What is counted. */
  metric: Metric['kind'];
  presets: BlockPreset[];
  /** One block id or pattern per line or comma. */
  blocks: string;
  top: number;
  excludeOperators: boolean;
  excluded: PlayerRef[];
  /** The commands of every place, one per line; index 0 is the first place. */
  rewards: string[];
  messages: Messages;
  countEveryMinutes: number;
  announcements: Announcement[];
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
    metric: 'mined',
    presets: ['wood'],
    blocks: '',
    top: 3,
    excludeOperators: true,
    excluded: [],
    rewards: Array.from({ length: MAX_TOP }, () => ''),
    messages: defaultMessages(),
    countEveryMinutes: DEFAULT_COUNT_MINUTES,
    announcements: defaultAnnouncements(),
  };
}

export function fromEvent(event: CompetitionEvent): EditorForm {
  const rewards = Array.from({ length: MAX_TOP }, () => '');
  for (const reward of event.rewards.places) {
    rewards[reward.place - 1] = reward.commands.join('\n');
  }
  return {
    name: event.name,
    timezone: event.timezone,
    start: instantToZoned(Date.parse(event.startsAt), event.timezone),
    end: instantToZoned(Date.parse(event.endsAt), event.timezone),
    metric: event.metric.kind,
    presets: event.metric.kind === 'mined' ? [...event.metric.presets] : ['wood'],
    blocks: event.metric.kind === 'mined' ? event.metric.blocks.join('\n') : '',
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
  if (form.metric === 'mined') {
    const blocks = parseBlocks(form.blocks);
    if (form.presets.length === 0 && blocks.length === 0) problems.push('metric');
    if (!blocks.every(isValidBlockPattern)) problems.push('blocks');
  }
  return problems;
}

/** The request body for the API; null when the times are not valid. */
export function toInput(form: EditorForm): EventInput | null {
  const start = zonedToInstant(form.start, form.timezone);
  const end = zonedToInstant(form.end, form.timezone);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const places = form.rewards
    .slice(0, form.top)
    .map((text, index) => ({ place: index + 1, commands: parseCommands(text) }))
    .filter((reward) => reward.commands.length > 0);
  return {
    name: form.name.trim(),
    timezone: form.timezone.trim(),
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
    metric:
      form.metric === 'mined'
        ? { kind: 'mined', presets: form.presets, blocks: parseBlocks(form.blocks) }
        : { kind: 'fish_caught' },
    scoring: { kind: 'sum' },
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
