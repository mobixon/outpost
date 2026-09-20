import { renderTemplate } from '@outpost/shared';
import {
  MAX_MESSAGE_LINES,
  MAX_TOP,
  type CompetitionEvent,
  type Messages,
  type Metric,
  type ProgressRow,
  type Standing,
  type StatCategory,
  type Target,
} from './shared.js';

const NOBODY = '&7Nobody has scored yet.';
const NOBODY_GOALS = '&7Nobody has reached them yet.';

/** "2d 4h", "3h 12m", "5m": how long is left. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return 'less than a minute';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  return `${rest}m`;
}

/** A moment in a time zone, for people: "28 Sep 2026, 18:00 GMT+2". */
export function formatInstant(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(ms));
}

export const formatScore = (score: number) => score.toLocaleString('en-US');

const CATEGORY_LABELS: Record<StatCategory, string> = {
  picked_up: 'Picked up',
  killed: 'Killed',
  crafted: 'Crafted',
  used: 'Used',
  broken: 'Broken',
  dropped: 'Dropped',
  killed_by: 'Killed by',
  custom: 'Counted',
};
const humanize = (key: string) => key.replace(/_/g, ' ');

/** What is counted, in a few words. */
export function metricLabel(metric: Metric): string {
  if (metric.kind === 'fish_caught') return 'Fish caught';
  const parts: string[] = metric.presets.map(humanize);
  const others = metric.kind === 'mined' ? metric.blocks.length : metric.ids.length;
  if (others > 0) parts.push(`${others} other`);
  const head = metric.kind === 'mined' ? 'Mined' : CATEGORY_LABELS[metric.category];
  return `${head}: ${parts.join(', ')}`;
}

/** What an event counts, in a few words: its metric, or its goals. */
export function eventLabel(event: Pick<CompetitionEvent, 'metric' | 'scoring'>): string {
  if (event.scoring.kind === 'targets') {
    return `Goals: ${event.scoring.targets.map((target) => target.label).join(', ')}`;
  }
  return event.metric === undefined ? '' : metricLabel(event.metric);
}

/** The progress of one player on the targets of a goals event, for their chat lines. */
export interface GoalView {
  lines: string[];
  /** How many players have reached all the targets. */
  completed: number;
}

/** One line per target: what is done and how far it is. */
export function goalLines(
  progress: readonly { label: string; value: number; amount: number }[],
): string[] {
  return progress.map(({ label, value, amount }) =>
    value >= amount
      ? `&a✓ &f${label} &a${formatScore(value)}&7/${formatScore(amount)}`
      : `&7• &f${label} &e${formatScore(value)}&7/${formatScore(amount)}`,
  );
}

/** The goals of a player: their row of progress, or zeros when they have made none. */
export function goalView(
  targets: readonly Target[],
  row: Pick<ProgressRow, 'targets'> | undefined,
  completed: number,
): GoalView {
  return {
    lines: goalLines(
      targets.map((target, index) => ({
        label: target.label,
        value: row?.targets[index]?.value ?? 0,
        amount: target.amount,
      })),
    ),
    completed,
  };
}

/** The lines of a text once its placeholders are filled in; empty lines are left out. */
export function toLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
    .slice(0, MAX_MESSAGE_LINES);
}

/** What the texts of a competition are filled in from. */
export type RenderableEvent = Pick<
  CompetitionEvent,
  'name' | 'startsAt' | 'endsAt' | 'timezone' | 'metric' | 'scoring' | 'messages' | 'participants'
>;

export interface Viewer {
  name: string;
}

/** One line per place of the top, from the entry template. */
export function topLines(
  messages: Messages,
  standings: readonly Standing[],
  top: number,
  empty = NOBODY,
): string {
  const shown = standings.slice(0, top);
  if (shown.length === 0) return empty;
  return shown
    .map((standing) =>
      renderTemplate(messages.entry, {
        place: String(standing.place),
        name: standing.name,
        score: formatScore(standing.score),
      }),
    )
    .join('\n');
}

function values(
  event: RenderableEvent,
  standings: readonly Standing[],
  now: number,
  viewer?: Viewer,
  goals?: GoalView,
): Record<string, string> {
  const targets = event.scoring.kind === 'targets';
  const own =
    viewer === undefined
      ? undefined
      : standings.find((standing) => standing.name.toLowerCase() === viewer.name.toLowerCase());
  const ends = Date.parse(event.endsAt);
  const starts = Date.parse(event.startsAt);
  return {
    command: event.messages.command,
    event: event.name,
    description: event.messages.description,
    metric: eventLabel(event),
    starts_at: formatInstant(starts, event.timezone),
    starts_in: formatDuration(starts - now),
    ends_at: formatInstant(ends, event.timezone),
    ends_in: formatDuration(ends - now),
    top: topLines(
      event.messages,
      standings,
      targets ? MAX_TOP : event.participants.top,
      targets ? NOBODY_GOALS : NOBODY,
    ),
    goals: goals?.lines.join('\n') ?? '',
    completed: String(goals?.completed ?? 0),
    player: viewer?.name ?? '',
    your_place: own === undefined ? '-' : `#${own.place}`,
    your_score: formatScore(own?.score ?? 0),
  };
}

/** The answer to the chat command. */
export function renderTop(
  event: RenderableEvent,
  standings: readonly Standing[],
  now: number,
  viewer?: Viewer,
  goals?: GoalView,
): string[] {
  return toLines(renderTemplate(event.messages.top, values(event, standings, now, viewer, goals)));
}

/** What a player sees on joining. */
export function renderJoin(
  event: RenderableEvent,
  standings: readonly Standing[],
  now: number,
  viewer?: Viewer,
  goals?: GoalView,
): string[] {
  return toLines(renderTemplate(event.messages.join, values(event, standings, now, viewer, goals)));
}

/** What everyone sees at the end. */
export function renderResults(
  event: RenderableEvent,
  standings: readonly Standing[],
  now: number,
  goals?: GoalView,
): string[] {
  return toLines(
    renderTemplate(event.messages.results, values(event, standings, now, undefined, goals)),
  );
}

/** What a winner sees when the reward is given. */
export function renderReward(
  event: { name: string; messages: Messages },
  winner: { name: string; place: number; score: number },
): string[] {
  return toLines(
    renderTemplate(event.messages.reward, {
      event: event.name,
      player: winner.name,
      place: String(winner.place),
      score: formatScore(winner.score),
    }),
  );
}

/** What an announcement of the event says at its moment. */
export function renderAnnouncement(
  event: RenderableEvent,
  text: string,
  standings: readonly Standing[],
  now: number,
  goals?: GoalView,
): string[] {
  return toLines(renderTemplate(text, values(event, standings, now, undefined, goals)));
}

/** What everyone sees when a player has reached all the goals. */
export function renderCompletion(
  event: { name: string; messages: Messages },
  player: string,
  number: number,
  completed: number,
): string[] {
  return toLines(
    renderTemplate(event.messages.completion, {
      event: event.name,
      player,
      number: String(number),
      completed: String(completed),
    }),
  );
}
