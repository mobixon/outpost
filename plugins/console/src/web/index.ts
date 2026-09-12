import { TerminalIcon } from '@lucide/vue';
import { defineWebPlugin, WEB_PLUGIN_API_VERSION } from '@outpost/web-plugin-api';
import { CONSOLE_PLUGIN_ID, ConsolePermission } from '../shared.js';
import en from './locales/en.js';
import ru from './locales/ru.js';

export default defineWebPlugin({
  id: CONSOLE_PLUGIN_ID,
  apiVersion: WEB_PLUGIN_API_VERSION,
  serverTabs: [
    {
      key: 'console',
      label: 'console.tab',
      icon: TerminalIcon,
      component: () => import('./ConsoleTab.vue'),
      // Moderators see the tab for the chat; the command line needs console.execute.
      permission: ConsolePermission.chat,
      capability: 'commands.send',
      order: 100,
    },
  ],
  messages: { en, ru },
});
