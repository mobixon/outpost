import { InfoIcon } from '@lucide/vue';
import { defineWebPlugin, WEB_PLUGIN_API_VERSION } from '@outpost/web-plugin-api';
import { ABOUT_PLUGIN_ID } from '../shared.js';
import en from './locales/en.js';
import ru from './locales/ru.js';

export default defineWebPlugin({
  id: ABOUT_PLUGIN_ID,
  apiVersion: WEB_PLUGIN_API_VERSION,
  routes: [{ path: '/about', name: 'about', component: () => import('./AboutPage.vue') }],
  navItems: [{ key: 'about', label: 'about.nav', icon: InfoIcon, to: '/about', order: 1000 }],
  messages: { en, ru },
});
