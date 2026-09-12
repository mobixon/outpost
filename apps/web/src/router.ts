import { EXTERNAL_AUTH_RETURN_PATH, type SessionState } from '@outpost/shared';
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
        path: '/invite/:token',
        name: 'invite',
        component: () => import('./pages/InvitePage.vue'),
      },
      {
        path: EXTERNAL_AUTH_RETURN_PATH,
        name: 'auth-return',
        component: () => import('./pages/AuthReturnPage.vue'),
      },
      {
        path: '/',
        component: AppLayout,
        children: [
          { path: '', name: 'home', component: () => import('./pages/HomePage.vue') },
          { path: '/account', name: 'account', component: () => import('./pages/AccountPage.vue') },
          {
            path: '/servers/:slug',
            component: () => import('./pages/server/ServerLayout.vue'),
            children: [
              {
                path: '',
                name: 'server-overview',
                component: () => import('./pages/server/OverviewTab.vue'),
              },
              {
                path: 'members',
                name: 'server-members',
                component: () => import('./pages/server/MembersTab.vue'),
              },
              {
                path: 'audit',
                name: 'server-audit',
                component: () => import('./pages/server/AuditTab.vue'),
              },
              {
                path: 'settings',
                name: 'server-settings',
                component: () => import('./pages/server/SettingsTab.vue'),
              },
              ...plugins.flatMap((plugin) =>
                (plugin.serverTabs ?? []).map((tab) => ({
                  path: tab.key,
                  name: `server-${plugin.id}-${tab.key}`,
                  component: tab.component,
                })),
              ),
            ],
          },
          {
            path: '/admin/users',
            name: 'admin-users',
            component: () => import('./pages/admin/UsersPage.vue'),
          },
          {
            path: '/admin/invitations',
            name: 'admin-invitations',
            component: () => import('./pages/admin/InvitationsPage.vue'),
          },
          {
            path: '/admin/audit',
            name: 'admin-audit',
            component: () => import('./pages/admin/AuditPage.vue'),
          },
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
