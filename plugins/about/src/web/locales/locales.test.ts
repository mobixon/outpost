import { findMissingMessageKeys } from '@outpost/web-plugin-api';
import { describe, expect, it } from 'vitest';
import en from './en.js';
import ru from './ru.js';

describe('about plugin translations', () => {
  it('has the same keys in every locale', () => {
    expect(findMissingMessageKeys(en, ru)).toEqual([]);
    expect(findMissingMessageKeys(ru, en)).toEqual([]);
  });
});
