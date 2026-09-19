// Wall-clock times in a time zone, for editors that let people pick a date and time there.

const parts = (ms: number, timeZone: string) => {
  const found = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(found.find((part) => part.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
};

/** How far ahead of UTC the time zone is at a moment, in milliseconds. */
function offsetMs(ms: number, timeZone: string): number {
  const { year, month, day, hour, minute, second } = parts(ms, timeZone);
  return Date.UTC(year, month - 1, day, hour, minute, second) - Math.floor(ms / 1000) * 1000;
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** `2026-09-28T18:00`: what a clock in the time zone shows at a moment, as a datetime-local value. */
export function instantToZoned(ms: number, timeZone: string): string {
  const { year, month, day, hour, minute } = parts(ms, timeZone);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

/**
 * The moment at which a clock in the time zone shows the given date and time (`2026-09-28T18:00`);
 * NaN for anything else. Of the two moments a clock shows when it is turned back, the earlier one.
 */
export function zonedToInstant(local: string, timeZone: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (match === null) return NaN;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // The offset depends on the moment, which is what is looked for: take it twice.
  const first = wall - offsetMs(wall, timeZone);
  return wall - offsetMs(first, timeZone);
}
