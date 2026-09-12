import type { WebPluginDefinition } from '@outpost/web-plugin-api';
import { createRouter, createWebHistory } from 'vue-router';
import AppLayout from './layout/AppLayout.vue';

export function createAppRouter(plugins: readonly WebPluginDefinition[]) {
  return createRouter({
    history: createWebHistory(),
    routes: [
      {
        path: '/',
        component: AppLayout,
        children: [
          { path: '', name: 'home', component: () => import('./pages/HomePage.vue') },
          ...plugins.flatMap((plugin) => plugin.routes ?? []),
          {
            path: '/:pathMatch(.*)*',
            name: 'not-found',
            component: () => import('./pages/NotFoundPage.vue'),
          },
        ],
      },
    ],
  });
}
