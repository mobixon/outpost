import { API_PREFIX, THEME_MODES, type ThemeMode } from '@outpost/shared';
import { apiSend } from '@outpost/web-plugin-api';
import { ref, watch } from 'vue';

export type { ThemeMode };

const STORAGE_KEY = 'outpost.theme';

export const isThemeMode = (value: unknown): value is ThemeMode =>
  (THEME_MODES as readonly unknown[]).includes(value);

function readStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isThemeMode(stored)) return stored;
  } catch {
    // Storage unavailable: fall back to the system setting.
  }
  return 'system';
}

/**
 * The theme choice; `system` follows the operating system setting. The browser remembers it, also
 * on the pages before login; signed-in users also keep it in their account.
 */
export const themeMode = ref<ThemeMode>(readStoredMode());

/** Applies the theme to the page and keeps it in sync with the choice and the OS setting. */
export function initThemeMode(): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = (): void => {
    const dark = themeMode.value === 'dark' || (themeMode.value === 'system' && media.matches);
    document.documentElement.classList.toggle('dark', dark);
  };
  apply();
  media.addEventListener('change', apply);
  watch(themeMode, (mode) => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Storage unavailable: the choice lasts for this page only.
    }
    apply();
  });
}

/** Takes over the theme saved in the account of the signed-in user, if there is one. */
export function adoptAccountTheme(theme: ThemeMode | null | undefined): void {
  if (theme !== null && theme !== undefined) themeMode.value = theme;
}

/** Saves the choice in the account; the browser remembers it even when this fails. */
export async function saveAccountTheme(theme: ThemeMode): Promise<void> {
  await apiSend('PUT', `${API_PREFIX}/me/theme`, { theme });
}
