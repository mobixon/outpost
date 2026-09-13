import { UsersIcon } from '@lucide/vue';
import { defineWebPlugin, WEB_PLUGIN_API_VERSION } from '@outpost/web-plugin-api';
import { PLAYERS_PLUGIN_ID, PlayersPermission } from '../shared.js';
import en from './locales/en.js';
import ru from './locales/ru.js';

export default defineWebPlugin({
  id: PLAYERS_PLUGIN_ID,
  apiVersion: WEB_PLUGIN_API_VERSION,
  serverTabs: [
    {
      key: 'players',
      label: 'players.tab',
      icon: UsersIcon,
      component: () => import('./PlayersTab.vue'),
      permission: PlayersPermission.view,
      capability: 'commands.send',
      order: 200,
    },
  ],
  messages: { en, ru },
});
