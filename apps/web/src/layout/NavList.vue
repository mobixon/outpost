<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import type { ShellNavItem } from '../shell.js';

defineProps<{ items: readonly ShellNavItem[] }>();

const { t } = useI18n();
</script>

<template>
  <nav :aria-label="t('nav.main')">
    <ul class="flex flex-col gap-1">
      <li v-for="item in items" :key="item.id">
        <RouterLink
          :to="item.to"
          class="text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors"
          active-class=""
          exact-active-class="bg-sidebar-accent !text-sidebar-primary"
        >
          <component :is="item.icon" class="size-4" aria-hidden="true" />
          <span>{{ t(item.label) }}</span>
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
