import { describe, expect, it } from 'vitest';
import { instantToZoned, zonedToInstant } from './time.js';

describe('zoned times', () => {
  it('turn a clock reading into a moment and back', () => {
    // Moscow is UTC+3 all year.
    expect(new Date(zonedToInstant('2026-09-28T18:00', 'Europe/Moscow')).toISOString()).toBe(
      '2026-09-28T15:00:00.000Z',
    );
    expect(instantToZoned(Date.parse('2026-09-28T15:00:00Z'), 'Europe/Moscow')).toBe(
      '2026-09-28T18:00',
    );
    expect(zonedToInstant('2026-09-28T18:00', 'UTC')).toBe(Date.parse('2026-09-28T18:00:00Z'));
  });

  it('follow daylight saving time', () => {
    // Berlin: UTC+1 in winter, UTC+2 in summer.
    expect(new Date(zonedToInstant('2026-01-15T12:00', 'Europe/Berlin')).toISOString()).toBe(
      '2026-01-15T11:00:00.000Z',
    );
    expect(new Date(zonedToInstant('2026-07-15T12:00', 'Europe/Berlin')).toISOString()).toBe(
      '2026-07-15T10:00:00.000Z',
    );
    // The clocks went forward at 02:00 on 2026-03-29: 03:30 is 01:30 UTC.
    expect(new Date(zonedToInstant('2026-03-29T03:30', 'Europe/Berlin')).toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
  });

  it('refuse other text', () => {
    expect(zonedToInstant('tomorrow', 'UTC')).toBeNaN();
    expect(zonedToInstant('2026-09-28 18:00', 'UTC')).toBeNaN();
  });
});
