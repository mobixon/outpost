import type { SessionState } from '@outpost/shared';
import type { WebPluginDefinition } from '@outpost/web-plugin-api';
import { createRouter, createWebHistory } from 'vue-router';
import AppLayout from './layout/AppLayout.vue';
import { redirectFor } from './session.js';

export function createAppRouter(
  plugins: readonly WebPluginDefinition[],
  session: SessionState | null,
) {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/setup', name: 'setup', component: () => import('./pages/SetupPage.vue') },
      { path: '/login', name: 'login', component: () => import('./pages/LoginPage.vue') },
      {
        path: '/',
        component: AppLayout,
        children: [
          { path: '', name: 'home', component: () => import('./pages/HomePage.vue') },
          { path: '/account', name: 'account', component: () => import('./pages/AccountPage.vue') },
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
  // Without a session state the server is unreachable; the layout shows a warning instead.
  if (session !== null) {
    router.beforeEach((to) => redirectFor(to.path, session, to.query['next']) ?? true);
  }
  return router;
}
