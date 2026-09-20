<script setup lang="ts">
import {
  API_PREFIX,
  serverModuleListSchema,
  serverModuleSchema,
  type ServerModule,
} from '@outpost/shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
  Switch,
} from '@outpost/ui';
import { apiFetch, apiSend, useServerContext } from '@outpost/web-plugin-api';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useErrorMessage } from '../../errors.js';

// The modules of the server: each can be switched off, except the essential ones. A module that is
// off shows no tab, does not answer and does not ask the game server anything.
const { t, te } = useI18n();
const errorMessage = useErrorMessage();
const { server, reload } = useServerContext();

const modules = ref<ServerModule[] | null>(null);
const busy = ref<string | null>(null);
const error = ref<string>();

const path = computed(() => `${API_PREFIX}/servers/${encodeURIComponent(server.value.id)}/modules`);
/** Keys of the messages: `outpost.player-details` is `outpost_player_details`. */
const keyOf = (id: string) => id.replace(/[.-]/g, '_');
const nameOf = (id: string) =>
  te(`modules.names.${keyOf(id)}`) ? t(`modules.names.${keyOf(id)}`) : id;
const textOf = (id: string) =>
  te(`modules.texts.${keyOf(id)}`) ? t(`modules.texts.${keyOf(id)}`) : '';

async function load(): Promise<void> {
  try {
    modules.value = (await apiFetch(path.value, serverModuleListSchema)).modules;
  } catch (err) {
    error.value = errorMessage(err);
  }
}

async function toggle(module: ServerModule, enabled: boolean): Promise<void> {
  if (busy.value !== null) return;
  busy.value = module.id;
  error.value = undefined;
  try {
    await apiSend(
      'PUT',
      `${path.value}/${encodeURIComponent(module.id)}`,
      { enabled },
      serverModuleSchema,
    );
    await load();
    // The tabs of the server follow.
    await reload();
  } catch (err) {
    error.value = errorMessage(err);
    await load();
  } finally {
    busy.value = null;
  }
}

onMounted(() => void load());
</script>

<template>
  <Card data-testid="modules-card">
    <CardHeader>
      <CardTitle>{{ t('modules.title') }}</CardTitle>
      <CardDescription>{{ t('modules.text') }}</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <div v-if="modules === null" class="flex justify-center py-4"><Spinner class="size-5" /></div>
      <ul v-else class="flex flex-col divide-y">
        <li v-for="module in modules" :key="module.id" class="flex items-center gap-4 py-3">
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="flex flex-wrap items-center gap-2 text-sm font-medium">
              {{ nameOf(module.id) }}
              <Badge v-if="module.essential" variant="secondary">{{
                t('modules.essential')
              }}</Badge>
            </span>
            <span class="text-muted-foreground text-xs">{{ textOf(module.id) }}</span>
          </div>
          <Switch
            :model-value="module.enabled"
            :disabled="module.essential || busy !== null"
            :aria-label="t('modules.switch', { name: nameOf(module.id) })"
            @update:model-value="(value: boolean) => toggle(module, value)"
          />
        </li>
      </ul>
      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
    </CardContent>
  </Card>
</template>
