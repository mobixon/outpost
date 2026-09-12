<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { servers } from '../servers.js';

const { t } = useI18n();
</script>

<template>
  <nav v-if="servers && servers.length > 0" :aria-label="t('nav.servers')" class="mt-6">
    <h2 class="text-muted-foreground px-3 pb-2 text-xs font-medium tracking-wide uppercase">
      {{ t('nav.servers') }}
    </h2>
    <ul class="flex flex-col gap-1">
      <li v-for="server in servers" :key="server.id">
        <RouterLink
          :to="`/servers/${server.slug}`"
          class="text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors"
          active-class="bg-sidebar-accent !text-sidebar-primary"
        >
          <span
            class="bg-muted-foreground/40 size-2 shrink-0 rounded-full"
            :title="t('home.notConnected')"
            aria-hidden="true"
          />
          <span class="truncate">{{ server.name }}</span>
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
