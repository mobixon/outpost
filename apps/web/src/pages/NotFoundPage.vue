<script setup lang="ts">
import { ArrowLeftIcon, CompassIcon } from '@lucide/vue';
import { Button } from '@outpost/ui';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';

const { t } = useI18n();
</script>

<template>
  <section class="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
    <CompassIcon class="text-muted-foreground size-12" aria-hidden="true" />
    <h1 class="text-2xl font-semibold tracking-tight">{{ t('notFound.title') }}</h1>
    <p class="text-muted-foreground">{{ t('notFound.text') }}</p>
    <Button as-child>
      <RouterLink to="/">
        <ArrowLeftIcon />
        {{ t('notFound.back') }}
      </RouterLink>
    </Button>
  </section>
</template>
