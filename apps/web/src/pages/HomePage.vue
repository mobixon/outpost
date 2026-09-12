<script setup lang="ts">
import { ServerIcon } from '@lucide/vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <section class="mx-auto max-w-5xl">
    <h1 class="mb-6 text-2xl font-semibold tracking-tight">{{ t('home.title') }}</h1>
    <div
      class="bg-background flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center"
    >
      <ServerIcon class="text-muted-foreground size-10" aria-hidden="true" />
      <h2 class="text-lg font-medium">{{ t('home.emptyTitle') }}</h2>
      <p class="text-muted-foreground max-w-md text-sm">{{ t('home.emptyText') }}</p>
    </div>
  </section>
</template>
