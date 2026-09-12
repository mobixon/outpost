import type { LocaleMessages, WebPluginDefinition } from '@outpost/web-plugin-api';

export const SUPPORTED_LOCALES = ['en', 'ru'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

const isSupported = (value: string): value is AppLocale =>
  (SUPPORTED_LOCALES as readonly string[]).includes(value);

/** The stored choice if it is valid, else the first supported browser language, else English. */
export function pickLocale(stored: string | null, browserLanguages: readonly string[]): AppLocale {
  if (stored !== null && isSupported(stored)) return stored;
  for (const language of browserLanguages) {
    const base = language.toLowerCase().split('-', 1)[0] ?? '';
    if (isSupported(base)) return base;
  }
  return 'en';
}

/**
 * Adds the messages of plugins to the core catalog. A plugin without a translation for a locale
 * falls back to its English messages. Plugins cannot replace existing top-level keys.
 */
export function mergeMessages(
  core: Record<AppLocale, LocaleMessages>,
  plugins: readonly WebPluginDefinition[],
  warn: (message: string) => void = console.warn,
): Record<AppLocale, LocaleMessages> {
  const merged: Record<AppLocale, LocaleMessages> = { en: { ...core.en }, ru: { ...core.ru } };
  for (const plugin of plugins) {
    if (!plugin.messages) continue;
    for (const locale of SUPPORTED_LOCALES) {
      const messages = plugin.messages[locale] ?? plugin.messages.en;
      for (const [key, value] of Object.entries(messages)) {
        if (key in merged[locale]) {
          warn(
            `Plugin "${plugin.id}" tried to replace the "${key}" translations (${locale}); ignored`,
          );
          continue;
        }
        merged[locale][key] = value;
      }
    }
  }
  return merged;
}
