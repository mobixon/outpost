import './styles.css';
import { createApp } from 'vue';
import App from './App.vue';
import { createAppI18n } from './i18n.js';
import { loadEnabledPlugins } from './plugins.js';
import { createAppRouter } from './router.js';
import { buildNavItems, shellKey } from './shell.js';
import { initThemeMode } from './theme/mode.js';

async function bootstrap(): Promise<void> {
  initThemeMode();
  const { plugins, apiAvailable } = await loadEnabledPlugins();

  createApp(App)
    .use(createAppI18n(plugins))
    .use(createAppRouter(plugins))
    .provide(shellKey, { navItems: buildNavItems(plugins), apiAvailable })
    .mount('#app');
}

void bootstrap();
