import { ApiError } from '@outpost/web-plugin-api';
import { useI18n } from 'vue-i18n';

/** Turns an API or network error into a translated message. */
export function useErrorMessage(): (error: unknown) => string {
  const { t, te } = useI18n();
  return (error) => {
    if (error instanceof ApiError) {
      const key = `errors.${error.code}`;
      return te(key) ? t(key) : error.message;
    }
    // fetch() rejects with a TypeError when the server cannot be reached.
    if (error instanceof TypeError) return t('errors.network');
    return t('errors.generic');
  };
}
