<script setup lang="ts">
import { CircleCheckIcon, CircleMinusIcon, CircleXIcon } from '@lucide/vue';
import {
  API_PREFIX,
  connectionStateSchema,
  connectionTestResultSchema,
  gameDefaults,
  RCON_DEFAULT_PORT,
  type ConnectionTestResult,
} from '@outpost/shared';
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
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Spinner,
} from '@outpost/ui';
import { apiFetch, apiSend, useServerContext } from '@outpost/web-plugin-api';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { SudoCancelled, withSudo } from '../../account/sudo.js';
import { useErrorMessage } from '../../errors.js';
import { loadServers } from '../../servers.js';

// The RCON connector: console commands over the RCON port of the server. It gives modules the
// capability commands.send.
const { t, te } = useI18n();
const errorMessage = useErrorMessage();
const { server, reload } = useServerContext();
/** The usual RCON port of the game of the server. */
const defaultPort = String(gameDefaults(server.value.game)?.rconPort ?? RCON_DEFAULT_PORT);
const form = reactive({ host: '', port: defaultPort, password: '' });
const hasPassword = ref(false);
const saved = ref(false);
const result = ref<ConnectionTestResult | null>(null);
const error = ref<string>();
const busy = ref<'load' | 'test' | 'save' | 'remove' | null>('load');

const path = computed(
  () => `${API_PREFIX}/servers/${encodeURIComponent(server.value.id)}/connection`,
);
const connected = computed(() => server.value.connectors.includes('rcon'));
const capabilities = computed(() =>
  server.value.capabilities.filter((capability) => capability.startsWith('commands.')),
);
const body = () => ({
  type: 'rcon' as const,
  host: form.host.trim(),
  port: Number(form.port),
  ...(form.password !== '' && { password: form.password }),
});

async function load(): Promise<void> {
  const { connection } = await apiFetch(path.value, connectionStateSchema);
  hasPassword.value = connection?.hasPassword ?? false;
  if (connection !== null) {
    Object.assign(form, {
      host: connection.host,
      port: String(connection.port),
      password: '',
    });
  }
}

async function run(kind: 'test' | 'save' | 'remove', action: () => Promise<void>): Promise<void> {
  if (busy.value !== null) return;
  busy.value = kind;
  error.value = undefined;
  saved.value = false;
  try {
    await action();
  } catch (err) {
    if (!(err instanceof SudoCancelled)) error.value = errorMessage(err);
  } finally {
    busy.value = null;
  }
}

const test = () =>
  run('test', async () => {
    result.value = await apiSend('POST', `${path.value}/test`, body(), connectionTestResultSchema);
  });

const save = () =>
  run('save', async () => {
    await withSudo(() => apiSend('PUT', path.value, body()));
    form.password = '';
    hasPassword.value = true;
    saved.value = true;
    await Promise.all([reload(), loadServers()]);
  });

const remove = () =>
  run('remove', async () => {
    await withSudo(() => apiSend('DELETE', path.value));
    Object.assign(form, { host: '', port: defaultPort, password: '' });
    hasPassword.value = false;
    result.value = null;
    await Promise.all([reload(), loadServers()]);
  });

const describeError = (code: string | null) =>
  code !== null && te(`errors.${code}`) ? t(`errors.${code}`) : (code ?? '');

onMounted(() => {
  load()
    .catch((err: unknown) => {
      error.value = errorMessage(err);
    })
    .finally(() => {
      busy.value = null;
    });
});
</script>

<template>
  <Card data-testid="connection-card">
    <CardHeader>
      <CardTitle class="flex flex-wrap items-center gap-2">
        {{ t('servers.connection.title') }}
        <Badge v-for="capability in capabilities" :key="capability" variant="outline">
          {{ capability }}
        </Badge>
      </CardTitle>
      <CardDescription>{{ t('servers.connection.text') }}</CardDescription>
    </CardHeader>
    <CardContent>
      <div v-if="busy === 'load'" class="flex justify-center py-4"><Spinner /></div>
      <form v-else class="flex flex-col gap-4" @submit.prevent="save">
        <FieldGroup class="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel for="connection-host">{{ t('servers.connection.host') }}</FieldLabel>
            <Input
              id="connection-host"
              v-model="form.host"
              class="font-mono"
              autocomplete="off"
              spellcheck="false"
              placeholder="srv-captain--minecraft"
              required
            />
            <FieldDescription>{{ t('servers.connection.hostHint') }}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel for="connection-port">{{ t('servers.connection.port') }}</FieldLabel>
            <Input
              id="connection-port"
              v-model="form.port"
              class="font-mono"
              inputmode="numeric"
              pattern="[0-9]{1,5}"
              required
            />
          </Field>
          <Field class="sm:col-span-2">
            <FieldLabel for="connection-password">{{
              t('servers.connection.password')
            }}</FieldLabel>
            <Input
              id="connection-password"
              v-model="form.password"
              type="password"
              autocomplete="new-password"
              :placeholder="hasPassword ? t('servers.connection.passwordKept') : ''"
              :required="!hasPassword"
            />
            <FieldDescription>{{ t('servers.connection.passwordHint') }}</FieldDescription>
          </Field>
        </FieldGroup>

        <ul v-if="result" class="flex flex-col gap-2 text-sm" data-testid="connection-test">
          <li v-for="step in result.steps" :key="step.step" class="flex items-start gap-2">
            <CircleCheckIcon
              v-if="step.ok === true"
              class="mt-0.5 size-4 shrink-0 text-emerald-600"
            />
            <CircleXIcon
              v-else-if="step.ok === false"
              class="text-destructive mt-0.5 size-4 shrink-0"
            />
            <CircleMinusIcon v-else class="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <div class="flex flex-col">
              <span>{{ t(`servers.connection.steps.${step.step}`) }}</span>
              <span v-if="step.ok === false" class="text-destructive">{{
                describeError(step.error)
              }}</span>
              <code v-if="step.detail" class="text-muted-foreground text-xs">{{
                step.detail
              }}</code>
            </div>
          </li>
        </ul>

        <Alert v-if="saved">
          <AlertDescription>{{ t('servers.connection.saved') }}</AlertDescription>
        </Alert>
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <div class="flex flex-wrap gap-2">
          <Button type="button" variant="outline" :disabled="busy !== null" @click="test">
            <Spinner v-if="busy === 'test'" />
            {{ t('servers.connection.test') }}
          </Button>
          <Button type="submit" :disabled="busy !== null">
            <Spinner v-if="busy === 'save'" />
            {{ t('servers.connection.save') }}
          </Button>
          <Button
            v-if="connected"
            type="button"
            variant="ghost"
            :disabled="busy !== null"
            @click="remove"
          >
            {{ t('servers.connection.remove') }}
          </Button>
        </div>
      </form>
    </CardContent>
  </Card>
</template>
