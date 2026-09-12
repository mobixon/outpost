import { ref, watch } from 'vue';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'outpost.theme';

function readStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Storage unavailable: fall back to the system setting.
  }
  return 'system';
}

/** The user's theme choice; `system` follows the operating system setting. */
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
