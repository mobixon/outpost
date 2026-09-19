import { ApiError } from '@outpost/web-plugin-api';

type Translate = (key: string, named?: Record<string, unknown>) => string;
type Exists = (key: string) => boolean;

/** What to tell people about an error of the API: the module's words first, then the general ones. */
export function describe(err: unknown, t: Translate, te: Exists): string {
  if (err instanceof ApiError) {
    for (const key of [`competitions.errors.${err.code}`, `errors.${err.code}`]) {
      if (te(key)) return t(key);
    }
    return err.message;
  }
  return te('errors.network') ? t('errors.network') : String(err);
}

export const formatTime = (iso: string, locale: string, timeZone?: string) =>
  new Date(iso).toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timeZone !== undefined && { timeZone }),
  });

/** "2d 4h", "3h 12m" or "5m" for a length of time in milliseconds. */
export function formatSpan(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  return `${rest}m`;
}
