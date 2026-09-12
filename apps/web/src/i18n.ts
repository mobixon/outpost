import type { WebPluginDefinition } from '@outpost/web-plugin-api';
import { createI18n } from 'vue-i18n';
import en from './locales/en.js';
import ru from './locales/ru.js';
import { mergeMessages, pickLocale, type AppLocale } from './messages.js';

export { SUPPORTED_LOCALES, type AppLocale } from './messages.js';

const STORAGE_KEY = 'outpost.locale';

function readStoredLocale(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Remembers the user's language choice in this browser. */
export function storeLocale(locale: AppLocale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this page only.
  }
  document.documentElement.lang = locale;
}

export function createAppI18n(plugins: readonly WebPluginDefinition[]) {
  const locale = pickLocale(readStoredLocale(), navigator.languages);
  document.documentElement.lang = locale;
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en',
    messages: mergeMessages({ en, ru }, plugins),
  });
}
