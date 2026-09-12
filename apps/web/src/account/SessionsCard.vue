<script setup lang="ts">
import { MonitorSmartphoneIcon } from '@lucide/vue';
import { API_PREFIX, sessionListSchema, type SessionInfo } from '@outpost/shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@outpost/ui';
import { apiFetch, apiSend } from '@outpost/web-plugin-api';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useErrorMessage } from '../errors.js';
import { describeUserAgent } from './user-agent.js';

const { t, locale } = useI18n();
const errorMessage = useErrorMessage();
const sessions = ref<SessionInfo[]>([]);
const error = ref<string>();
const busy = ref(false);

async function load(): Promise<void> {
  sessions.value = (await apiFetch(`${API_PREFIX}/me/sessions`, sessionListSchema)).sessions;
}

async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  error.value = undefined;
  busy.value = true;
  try {
    await action();
    await load();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

const revoke = (id: string) =>
  run(() => apiSend('DELETE', `${API_PREFIX}/me/sessions/${encodeURIComponent(id)}`));
const revokeOthers = () => run(() => apiSend('DELETE', `${API_PREFIX}/me/sessions`));

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' });

onMounted(() => {
  load().catch((err: unknown) => {
    error.value = errorMessage(err);
  });
});
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>{{ t('account.sessions.title') }}</CardTitle>
      <CardDescription>{{ t('account.sessions.description') }}</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <ul class="divide-y">
        <li v-for="session in sessions" :key="session.id" class="flex items-center gap-3 py-3">
          <MonitorSmartphoneIcon class="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="flex items-center gap-2 text-sm font-medium">
              {{ describeUserAgent(session.userAgent) ?? t('account.sessions.unknownDevice') }}
              <Badge v-if="session.current" variant="secondary">
                {{ t('account.sessions.current') }}
              </Badge>
            </span>
            <span class="text-muted-foreground truncate text-xs">
              {{ session.ip }} ·
              {{ t('account.sessions.lastSeen', { time: formatTime(session.lastSeenAt) }) }}
            </span>
          </div>
          <Button
            v-if="!session.current"
            variant="outline"
            size="sm"
            :disabled="busy"
            @click="revoke(session.id)"
          >
            {{ t('account.sessions.revoke') }}
          </Button>
        </li>
      </ul>
      <Button
        v-if="sessions.length > 1"
        variant="outline"
        class="self-start"
        :disabled="busy"
        @click="revokeOthers"
      >
        {{ t('account.sessions.revokeOthers') }}
      </Button>
      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
    </CardContent>
  </Card>
</template>
