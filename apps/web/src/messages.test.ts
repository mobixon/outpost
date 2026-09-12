import {
  defineWebPlugin,
  findMissingMessageKeys,
  WEB_PLUGIN_API_VERSION,
} from '@outpost/web-plugin-api';
import { describe, expect, it, vi } from 'vitest';
import en from './locales/en.js';
import ru from './locales/ru.js';
import { mergeMessages, pickLocale } from './messages.js';

describe('core translations', () => {
  it('has the same keys in every locale', () => {
    expect(findMissingMessageKeys(en, ru)).toEqual([]);
    expect(findMissingMessageKeys(ru, en)).toEqual([]);
  });
});

describe('pickLocale', () => {
  it.each([
    ['ru', ['en-US'], 'ru'],
    [null, ['ru-RU', 'en'], 'ru'],
    [null, ['de-DE', 'en-GB'], 'en'],
    ['de', ['de-DE'], 'en'],
    [null, [], 'en'],
  ] as const)('stored %j, browser %j -> %s', (stored, languages, expected) => {
    expect(pickLocale(stored, languages)).toBe(expected);
  });
});

describe('mergeMessages', () => {
  const core = { en: { app: { name: 'Outpost' } }, ru: { app: { name: 'Outpost' } } };

  it('adds plugin messages and falls back to English for missing locales', () => {
    const plugin = defineWebPlugin({
      id: 'test.hello',
      apiVersion: WEB_PLUGIN_API_VERSION,
      messages: { en: { hello: { title: 'Hello' } } },
    });
    const merged = mergeMessages(core, [plugin]);
    expect(merged.en['hello']).toEqual({ title: 'Hello' });
    expect(merged.ru['hello']).toEqual({ title: 'Hello' });
  });

  it('does not let a plugin replace existing keys', () => {
    const warn = vi.fn();
    const plugin = defineWebPlugin({
      id: 'test.evil',
      apiVersion: WEB_PLUGIN_API_VERSION,
      messages: { en: { app: { name: 'Evil' } } },
    });
    const merged = mergeMessages(core, [plugin], warn);
    expect(merged.en['app']).toEqual({ name: 'Outpost' });
    expect(warn).toHaveBeenCalled();
  });
});
