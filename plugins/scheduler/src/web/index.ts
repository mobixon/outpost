import { CalendarClockIcon } from '@lucide/vue';
import { defineWebPlugin, WEB_PLUGIN_API_VERSION } from '@outpost/web-plugin-api';
import { SCHEDULER_PLUGIN_ID, SchedulerPermission } from '../constants.js';
import en from './locales/en.js';
import ru from './locales/ru.js';

export default defineWebPlugin({
  id: SCHEDULER_PLUGIN_ID,
  apiVersion: WEB_PLUGIN_API_VERSION,
  serverTabs: [
    {
      key: 'scheduler',
      label: 'scheduler.tab',
      icon: CalendarClockIcon,
      component: () => import('./SchedulerTab.vue'),
      permission: SchedulerPermission.view,
      capability: 'commands.send',
      order: 300,
    },
  ],
  messages: { en, ru },
});
