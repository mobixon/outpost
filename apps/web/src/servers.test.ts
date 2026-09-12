import { SLUG_PATTERN } from '@outpost/shared';
import { describe, expect, it } from 'vitest';
import { slugFromName } from './servers.js';

describe('slugFromName', () => {
  it.each([
    ['Survival', 'survival'],
    ['My Survival!', 'my-survival'],
    ['  Café  Crème ', 'cafe-creme'],
    ['Выживание', ''],
    ['a'.repeat(40), 'a'.repeat(32)],
    ['Long name ending in a dash position here -- x', 'long-name-ending-in-a-dash-posit'],
  ])('%j -> %j', (name, slug) => {
    expect(slugFromName(name)).toBe(slug);
  });

  it('suggests valid short names', () => {
    for (const name of ['Survival 2', 'MC: Creative', 'x-y']) {
      expect(slugFromName(name)).toMatch(SLUG_PATTERN);
    }
  });
});
