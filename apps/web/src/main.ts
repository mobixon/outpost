import './styles.css';
import { onUnauthenticated } from '@outpost/web-plugin-api';
import { createApp } from 'vue';
import App from './App.vue';
import { createAppI18n } from './i18n.js';
import { loadEnabledPlugins } from './plugins.js';
import { createAppRouter } from './router.js';
import { loadSession } from './session.js';
import { buildNavItems, buildServerTabs, shellKey } from './shell.js';
import { adoptAccountTheme, initThemeMode } from './theme/mode.js';

async function bootstrap(): Promise<void> {
  initThemeMode();
  const session = await loadSession();
  // The theme saved in the account wins over the one this browser remembers.
  adoptAccountTheme(session?.user?.theme);
  const signedIn = session?.status === 'active' && !session.twoFactorEnrollmentRequired;
  const { plugins, games } = signedIn
    ? await loadEnabledPlugins()
    : { plugins: [], games: new Map<string, readonly string[] | null>() };

  // When the session ends while the app is open, start over at the login page.
  onUnauthenticated(() => {
    if (window.location.pathname === '/login') return;
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  });

  createApp(App)
    .use(createAppI18n(plugins))
    .use(createAppRouter(plugins, session))
    .provide(shellKey, {
      navItems: buildNavItems(plugins, signedIn ? session : null),
      serverTabs: buildServerTabs(plugins, games),
      session,
    })
    .mount('#app');
}

void bootstrap();
