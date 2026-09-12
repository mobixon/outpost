<script setup lang="ts">
import { CircleCheckIcon, CircleXIcon, PlugZapIcon, RefreshCwIcon } from '@lucide/vue';
import { API_PREFIX, serverStatusSchema, type ServerStatus } from '@outpost/shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Spinner,
} from '@outpost/ui';
import { apiFetch, useServerContext } from '@outpost/web-plugin-api';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { useShell } from '../../shell.js';

const { t, te } = useI18n();
const shell = useShell();
const { server } = useServerContext();
const isSuperadmin = shell.session?.user?.isSuperadmin === true;
const status = ref<ServerStatus | null>(null);
const loading = ref(false);

async function loadStatus(): Promise<void> {
  if (!server.value.connected || loading.value) return;
  loading.value = true;
  try {
    status.value = await apiFetch(
      `${API_PREFIX}/servers/${encodeURIComponent(server.value.id)}/status`,
      serverStatusSchema,
    );
  } catch {
    status.value = null;
  } finally {
    loading.value = false;
  }
}

/** A permission in words when the core or the module translates it, else its key. */
const describe = (permission: string) =>
  te(`permissions.${permission}`) ? t(`permissions.${permission}`) : permission;
const describeError = (code: string | null) =>
  code !== null && te(`errors.${code}`) ? t(`errors.${code}`) : (code ?? '');

onMounted(loadStatus);
</script>

<template>
  <div class="flex flex-col gap-6">
    <Card>
      <CardHeader class="flex flex-row items-center justify-between gap-2">
        <CardTitle>{{ t('servers.overview.connection') }}</CardTitle>
        <Button
          v-if="server.connected"
          variant="ghost"
          size="icon"
          :disabled="loading"
          :aria-label="t('servers.overview.refresh')"
          :title="t('servers.overview.refresh')"
          @click="loadStatus"
        >
          <RefreshCwIcon :class="{ 'animate-spin': loading }" />
        </Button>
      </CardHeader>
      <CardContent class="flex flex-col gap-4 text-sm">
        <Alert v-if="!server.connected">
          <PlugZapIcon />
          <AlertDescription class="flex flex-col items-start gap-2">
            <span>{{
              isSuperadmin
                ? t('servers.overview.notConnectedAdmin')
                : t('servers.overview.notConnected')
            }}</span>
            <Button v-if="isSuperadmin" as-child size="sm" variant="outline">
              <RouterLink :to="`/servers/${server.slug}/settings`">
                {{ t('servers.overview.connect') }}
              </RouterLink>
            </Button>
          </AlertDescription>
        </Alert>

        <template v-else>
          <div v-if="status === null" class="flex justify-center py-2"><Spinner /></div>
          <template v-else>
            <p class="flex items-center gap-2" data-testid="server-reachable">
              <CircleCheckIcon v-if="status.reachable" class="size-4 text-emerald-600" />
              <CircleXIcon v-else class="text-destructive size-4" />
              {{ status.reachable ? t('servers.overview.online') : t('servers.overview.offline') }}
              <Badge variant="outline">RCON</Badge>
            </p>
            <p v-if="!status.reachable" class="text-muted-foreground">
              {{ describeError(status.error) }}
            </p>
            <div v-if="status.players">
              <p class="text-muted-foreground mb-2">
                {{
                  t('servers.overview.players', {
                    online: status.players.online,
                    max: status.players.max,
                  })
                }}
              </p>
              <ul class="flex flex-wrap gap-2">
                <li v-for="name in status.players.names" :key="name">
                  <Badge variant="secondary" class="font-mono">{{ name }}</Badge>
                </li>
              </ul>
            </div>
          </template>
        </template>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>{{ t('servers.overview.access') }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-3 text-sm">
        <p>
          <span class="text-muted-foreground">{{ t('account.role') }}:</span>
          {{ server.role ? t(`roles.${server.role}`) : t('account.superadmin') }}
        </p>
        <div>
          <p class="text-muted-foreground mb-1">{{ t('servers.overview.youCan') }}</p>
          <ul class="list-disc pl-5">
            <li v-for="permission in server.permissions" :key="permission">
              {{ describe(permission) }}
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
