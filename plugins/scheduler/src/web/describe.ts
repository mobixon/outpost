import cronstrue from 'cronstrue';
// Registers the Russian texts with cronstrue; English is built in.
import 'cronstrue/locales/ru.js';

/** The schedule in words, e.g. "At 04:00, only on Monday"; null when it cannot be read. */
export function describeCron(cron: string, locale: string): string | null {
  try {
    return cronstrue.toString(cron, {
      locale: locale.startsWith('ru') ? 'ru' : 'en',
      use24HourTimeFormat: true,
      throwExceptionOnParseError: true,
    });
  } catch {
    return null;
  }
}
