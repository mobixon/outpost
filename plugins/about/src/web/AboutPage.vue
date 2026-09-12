<script setup lang="ts">
import { CircleAlertIcon } from '@lucide/vue';
import { pluginApiPath } from '@outpost/shared';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Spinner,
} from '@outpost/ui';
import { apiFetch } from '@outpost/web-plugin-api';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ABOUT_PLUGIN_ID, aboutInfoSchema, type AboutInfo } from '../shared.js';

const { t, locale } = useI18n();
const info = ref<AboutInfo>();
const error = ref<string>();

onMounted(async () => {
  try {
    info.value = await apiFetch(pluginApiPath(ABOUT_PLUGIN_ID, '/info'), aboutInfoSchema);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(locale.value, { dateStyle: 'long', timeStyle: 'short' });
</script>

<template>
  <section class="mx-auto flex max-w-3xl flex-col gap-6">
    <h1 class="text-2xl font-semibold tracking-tight">{{ t('about.title') }}</h1>

    <Alert v-if="error" variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>{{ t('about.loadError') }}</AlertTitle>
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <template v-else-if="info">
      <Card>
        <CardContent>
          <dl class="grid grid-cols-[max-content_1fr] gap-x-8 gap-y-2">
            <dt class="text-muted-foreground">{{ t('about.version') }}</dt>
            <dd class="font-mono">{{ info.version }}</dd>
            <dt class="text-muted-foreground">{{ t('about.installedAt') }}</dt>
            <dd>{{ formatDate(info.installedAt) }}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{{ t('about.modules') }}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul class="divide-y">
            <li
              v-for="plugin in info.plugins"
              :key="plugin.id"
              class="flex items-center justify-between py-2"
            >
              <code class="text-sm">{{ plugin.id }}</code>
              <Badge variant="secondary">{{ plugin.version }}</Badge>
            </li>
          </ul>
        </CardContent>
      </Card>
    </template>

    <Spinner v-else class="size-6" />
  </section>
</template>
