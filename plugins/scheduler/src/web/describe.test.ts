import { describe, expect, it } from 'vitest';
import { describeCron } from './describe.js';

describe('describeCron', () => {
  it('describes schedules in English and Russian', () => {
    expect(describeCron('0 4 * * *', 'en')).toContain('04:00');
    const russian = describeCron('0 4 * * *', 'ru-RU');
    expect(russian).toContain('04:00');
    expect(russian).toMatch(/[а-я]/i);
  });

  it('gives null for what it cannot read', () => {
    expect(describeCron('not a schedule', 'en')).toBeNull();
  });
});
