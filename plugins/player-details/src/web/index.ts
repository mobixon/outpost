import { BackpackIcon } from '@lucide/vue';
import { defineWebPlugin, WEB_PLUGIN_API_VERSION } from '@outpost/web-plugin-api';
import { PLAYER_DETAILS_PLUGIN_ID, PlayerDetailsPermission } from '../shared.js';
import en from './locales/en.js';
import ru from './locales/ru.js';

export default defineWebPlugin({
  id: PLAYER_DETAILS_PLUGIN_ID,
  apiVersion: WEB_PLUGIN_API_VERSION,
  serverTabs: [
    {
      key: 'player-details',
      label: 'playerDetails.tab',
      icon: BackpackIcon,
      component: () => import('./PlayerDetailsTab.vue'),
      permission: PlayerDetailsPermission.view,
      capability: 'files.read',
      order: 250,
    },
  ],
  messages: { en, ru },
});
