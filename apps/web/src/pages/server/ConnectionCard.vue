<script setup lang="ts">
import {
  CircleCheckIcon,
  CircleMinusIcon,
  CircleXIcon,
  ContainerIcon,
  PlugIcon,
} from '@lucide/vue';
import {
  API_PREFIX,
  connectionStateSchema,
  connectionTestResultSchema,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@outpost/ui';
import { apiFetch, apiSend, useServerContext } from '@outpost/web-plugin-api';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { SudoCancelled, withSudo } from '../../account/sudo.js';
import { useErrorMessage } from '../../errors.js';
import { loadServers } from '../../servers.js';

// How Outpost reaches the server. This version connects over RCON; the full connection (Docker,
// live log, files) is shown as coming later.
const { t, te } = useI18n();
const errorMessage = useErrorMessage();
const { server, reload } = useServerContext();
const form = reactive({
  game: 'minecraft-java',
  host: '',
  port: String(RCON_DEFAULT_PORT),
  password: '',
});
const hasPassword = ref(false);
const saved = ref(false);
const result = ref<ConnectionTestResult | null>(null);
const error = ref<string>();
const busy = ref<'load' | 'test' | 'save' | 'remove' | null>('load');

const path = computed(
  () => `${API_PREFIX}/servers/${encodeURIComponent(server.value.id)}/connection`,
);
const body = () => ({
  type: 'rcon' as const,
  game: form.game,
  host: form.host.trim(),
  port: Number(form.port),
  ...(form.password !== '' && { password: form.password }),
});

async function load(): Promise<void> {
  const { connection } = await apiFetch(path.value, connectionStateSchema);
  hasPassword.value = connection?.hasPassword ?? false;
  if (connection !== null) {
    Object.assign(form, {
      game: connection.game,
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
    Object.assign(form, { host: '', port: String(RCON_DEFAULT_PORT), password: '' });
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
      <CardTitle>{{ t('servers.connection.title') }}</CardTitle>
      <CardDescription>{{ t('servers.connection.text') }}</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-6">
      <div
        class="grid gap-3 sm:grid-cols-2"
        role="radiogroup"
        :aria-label="t('servers.connection.type')"
      >
        <div
          role="radio"
          aria-checked="true"
          class="ring-primary flex gap-3 rounded-lg border p-4 ring-2"
        >
          <PlugIcon class="text-primary mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div class="flex flex-col gap-1">
            <span class="font-medium">{{ t('servers.connection.rcon') }}</span>
            <span class="text-muted-foreground text-sm">{{
              t('servers.connection.rconText')
            }}</span>
          </div>
        </div>
        <div
          role="radio"
          aria-checked="false"
          aria-disabled="true"
          class="flex gap-3 rounded-lg border border-dashed p-4 opacity-70"
        >
          <ContainerIcon class="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div class="flex flex-col gap-1">
            <span class="flex flex-wrap items-center gap-2 font-medium">
              {{ t('servers.connection.full') }}
              <Badge variant="outline">{{ t('servers.connection.later') }}</Badge>
            </span>
            <span class="text-muted-foreground text-sm">{{
              t('servers.connection.fullText')
            }}</span>
          </div>
        </div>
      </div>

      <div v-if="busy === 'load'" class="flex justify-center py-4"><Spinner /></div>
      <form v-else class="flex flex-col gap-4" @submit.prevent="save">
        <FieldGroup class="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel for="connection-game">{{ t('servers.connection.game') }}</FieldLabel>
            <Select v-model="form.game">
              <SelectTrigger id="connection-game" class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="minecraft-java">{{ t('games.minecraftJava') }}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div />
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
            v-if="server.connected"
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
