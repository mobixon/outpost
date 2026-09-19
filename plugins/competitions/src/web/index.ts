import { TrophyIcon } from '@lucide/vue';
import { defineWebPlugin, WEB_PLUGIN_API_VERSION } from '@outpost/web-plugin-api';
import { COMPETITIONS_PLUGIN_ID, CompetitionsPermission } from '../constants.js';
import en from './locales/en.js';
import ru from './locales/ru.js';

export default defineWebPlugin({
  id: COMPETITIONS_PLUGIN_ID,
  apiVersion: WEB_PLUGIN_API_VERSION,
  serverTabs: [
    {
      key: 'events',
      label: 'competitions.tab',
      icon: TrophyIcon,
      component: () => import('./CompetitionsTab.vue'),
      permission: CompetitionsPermission.view,
      capability: 'stats.read',
      order: 350,
    },
  ],
  messages: { en, ru },
});
