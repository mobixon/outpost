<script setup lang="ts">
import { LinkIcon } from '@lucide/vue';
import { API_PREFIX, identityListSchema, type IdentityInfo } from '@outpost/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@outpost/ui';
import { apiFetch, apiSend } from '@outpost/web-plugin-api';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useErrorMessage } from '../errors.js';
import { startExternalAuth } from '../external-auth.js';
import { useShell } from '../shell.js';
import { SudoCancelled, withSudo } from './sudo.js';

const { t, locale } = useI18n();
const errorMessage = useErrorMessage();
const shell = useShell();
const identities = ref<IdentityInfo[]>([]);
const error = ref<string>();
const busy = ref(false);

interface Row {
  provider: string;
  name: string;
  identity: IdentityInfo | undefined;
  configured: boolean;
}

// Every configured provider, plus linked ones that were removed from the configuration since.
const rows = computed<Row[]>(() => {
  const configured = shell.session?.providers ?? [];
  return [
    ...configured.map((provider) => ({
      provider: provider.id,
      name: provider.name,
      identity: identities.value.find((identity) => identity.provider === provider.id),
      configured: true,
    })),
    ...identities.value
      .filter((identity) => !configured.some((provider) => provider.id === identity.provider))
      .map((identity) => ({
        provider: identity.provider,
        name: identity.providerName,
        identity,
        configured: false,
      })),
  ];
});

async function load(): Promise<void> {
  identities.value = (await apiFetch(`${API_PREFIX}/me/identities`, identityListSchema)).identities;
}

async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  error.value = undefined;
  busy.value = true;
  try {
    await action();
  } catch (err) {
    if (!(err instanceof SudoCancelled)) error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

const link = (provider: string) =>
  run(() => withSudo(() => startExternalAuth(provider, { intent: 'link' }, '/account')));

const unlink = (provider: string) =>
  run(async () => {
    await withSudo(() =>
      apiSend('DELETE', `${API_PREFIX}/me/identities/${encodeURIComponent(provider)}`),
    );
    await load();
  });

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(locale.value, { dateStyle: 'medium' });

onMounted(() => {
  load().catch((err: unknown) => {
    error.value = errorMessage(err);
  });
});
</script>

<template>
  <Card v-if="rows.length > 0" data-testid="identities-card">
    <CardHeader>
      <CardTitle>{{ t('account.identities.title') }}</CardTitle>
      <CardDescription>{{ t('account.identities.description') }}</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <ul class="divide-y">
        <li v-for="row in rows" :key="row.provider" class="flex items-center gap-3 py-3">
          <LinkIcon class="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="text-sm font-medium">{{ row.name }}</span>
            <span class="text-muted-foreground truncate text-xs">
              <template v-if="row.identity">
                {{ row.identity.displayName ?? row.identity.provider }} ·
                {{ t('account.identities.linkedAt', { date: formatDate(row.identity.createdAt) }) }}
              </template>
              <template v-else>{{ t('account.identities.notLinked') }}</template>
            </span>
          </div>
          <Button
            v-if="row.identity"
            variant="outline"
            size="sm"
            :disabled="busy"
            @click="unlink(row.provider)"
          >
            {{ t('account.identities.unlink') }}
          </Button>
          <Button
            v-else-if="row.configured"
            variant="outline"
            size="sm"
            :disabled="busy"
            @click="link(row.provider)"
          >
            {{ t('account.identities.link') }}
          </Button>
        </li>
      </ul>
      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
    </CardContent>
  </Card>
</template>
