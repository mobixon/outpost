<script setup lang="ts">
import {
  LayoutDashboardIcon,
  ScrollTextIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from '@lucide/vue';
import { CorePermission, type ServerSummary } from '@outpost/shared';
import { Alert, AlertDescription, Badge, Spinner } from '@outpost/ui';
import { serverContextKey } from '@outpost/web-plugin-api';
import { computed, provide, ref, watch, type Component, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { useErrorMessage } from '../../errors.js';
import { loadServers } from '../../servers.js';
import { useShell } from '../../shell.js';

interface Tab {
  key: string;
  label: string;
  icon: Component | LucideIcon;
  permission: string;
  capability?: string;
  order: number;
}

const CORE_TABS: readonly Tab[] = [
  {
    key: '',
    label: 'servers.tabs.overview',
    icon: LayoutDashboardIcon,
    permission: CorePermission.view,
    order: 0,
  },
  {
    key: 'members',
    label: 'servers.tabs.members',
    icon: UsersIcon,
    permission: CorePermission.members,
    order: 800,
  },
  {
    key: 'audit',
    label: 'servers.tabs.audit',
    icon: ScrollTextIcon,
    permission: CorePermission.audit,
    order: 850,
  },
  {
    key: 'settings',
    label: 'servers.tabs.settings',
    icon: SettingsIcon,
    permission: CorePermission.manage,
    order: 900,
  },
];

const { t } = useI18n();
const errorMessage = useErrorMessage();
const shell = useShell();
const route = useRoute();
const server = ref<ServerSummary | null>(null);
const missing = ref(false);
const error = ref<string>();

const slug = computed(() => String(route.params['slug'] ?? ''));

async function load(): Promise<void> {
  try {
    const found = (await loadServers()).find((candidate) => candidate.slug === slug.value);
    server.value = found ?? null;
    missing.value = found === undefined;
  } catch (err) {
    error.value = errorMessage(err);
  }
}

watch(slug, load, { immediate: true });

// Tabs render only while `server` is set, so they always see a server.
provide(serverContextKey, { server: server as Readonly<Ref<ServerSummary>>, reload: load });

const tabs = computed(() => {
  const current = server.value;
  if (current === null) return [];
  return [...CORE_TABS, ...shell.serverTabs]
    .filter(
      (tab) =>
        current.permissions.includes(tab.permission) &&
        (tab.capability === undefined || current.capabilities.includes(tab.capability)),
    )
    .sort((a, b) => a.order - b.order);
});

/** The tab of the current URL: the path segment after the server's short name. */
const currentKey = computed(() => route.path.split('/')[3] ?? '');
const allowed = computed(() => tabs.value.some((tab) => tab.key === currentKey.value));
const tabPath = (key: string) =>
  key === '' ? `/servers/${slug.value}` : `/servers/${slug.value}/${key}`;
</script>

<template>
  <section class="mx-auto flex max-w-5xl flex-col gap-6">
    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div v-else-if="missing" class="flex flex-col gap-2">
      <h1 class="text-2xl font-semibold tracking-tight">{{ t('servers.notFoundTitle') }}</h1>
      <p class="text-muted-foreground text-sm">{{ t('servers.notFoundText') }}</p>
    </div>

    <div v-else-if="server === null" class="flex justify-center py-12">
      <Spinner class="size-6" />
    </div>

    <template v-else>
      <header class="flex flex-col gap-1">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-2xl font-semibold tracking-tight">{{ server.name }}</h1>
          <Badge variant="secondary">
            {{ server.role ? t(`roles.${server.role}`) : t('account.superadmin') }}
          </Badge>
          <Badge v-if="!server.connected" variant="outline">{{ t('home.notConnected') }}</Badge>
        </div>
        <span class="text-muted-foreground font-mono text-sm">{{ server.slug }}</span>
      </header>

      <nav :aria-label="t('servers.tabsLabel')" class="-mb-2 overflow-x-auto border-b">
        <ul class="flex gap-1">
          <li v-for="tab in tabs" :key="tab.key">
            <RouterLink
              :to="tabPath(tab.key)"
              class="text-muted-foreground hover:text-foreground flex items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors"
              exact-active-class="!border-primary !text-foreground"
            >
              <component :is="tab.icon" class="size-4" aria-hidden="true" />
              {{ t(tab.label) }}
            </RouterLink>
          </li>
        </ul>
      </nav>

      <RouterView v-if="allowed" :key="server.id" />
      <Alert v-else>
        <AlertDescription>{{ t('servers.noAccess') }}</AlertDescription>
      </Alert>
    </template>
  </section>
</template>
