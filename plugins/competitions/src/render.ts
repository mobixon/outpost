import { renderTemplate } from '@outpost/shared';
import {
  MAX_MESSAGE_LINES,
  type CompetitionEvent,
  type Messages,
  type Metric,
  type Standing,
} from './shared.js';

const NOBODY = '&7Nobody has scored yet.';

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

/** What is counted, in a few words. */
export function metricLabel(metric: Metric): string {
  if (metric.kind === 'fish_caught') return 'Fish caught';
  const parts: string[] = [...metric.presets];
  if (metric.blocks.length > 0) parts.push(`${metric.blocks.length} other`);
  return `Mined: ${parts.join(', ')}`;
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
  'name' | 'endsAt' | 'timezone' | 'metric' | 'messages' | 'participants'
>;

export interface Viewer {
  name: string;
}

/** One line per place of the top, from the entry template. */
export function topLines(messages: Messages, standings: readonly Standing[], top: number): string {
  const shown = standings.slice(0, top);
  if (shown.length === 0) return NOBODY;
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
): Record<string, string> {
  const own =
    viewer === undefined
      ? undefined
      : standings.find((standing) => standing.name.toLowerCase() === viewer.name.toLowerCase());
  const ends = Date.parse(event.endsAt);
  return {
    event: event.name,
    description: event.messages.description,
    metric: metricLabel(event.metric),
    ends_at: formatInstant(ends, event.timezone),
    ends_in: formatDuration(ends - now),
    top: topLines(event.messages, standings, event.participants.top),
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
): string[] {
  return toLines(renderTemplate(event.messages.top, values(event, standings, now, viewer)));
}

/** What a player sees on joining. */
export function renderJoin(
  event: RenderableEvent,
  standings: readonly Standing[],
  now: number,
  viewer?: Viewer,
): string[] {
  return toLines(renderTemplate(event.messages.join, values(event, standings, now, viewer)));
}

/** What everyone sees at the end. */
export function renderResults(
  event: RenderableEvent,
  standings: readonly Standing[],
  now: number,
): string[] {
  return toLines(renderTemplate(event.messages.results, values(event, standings, now)));
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
