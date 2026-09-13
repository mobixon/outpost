<script setup lang="ts">
import { CircleCheckIcon, CircleMinusIcon, CircleXIcon, KeyRoundIcon } from '@lucide/vue';
import {
  API_PREFIX,
  filesStateSchema,
  filesTestResultSchema,
  SFTP_DEFAULT_PORT,
  type FilesInfo,
  type FilesTestResult,
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
  Switch,
  Textarea,
} from '@outpost/ui';
import { ApiError, apiFetch, apiSend, useServerContext } from '@outpost/web-plugin-api';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { SudoCancelled, withSudo } from '../../account/sudo.js';
import { useErrorMessage } from '../../errors.js';
import { loadServers } from '../../servers.js';

// The Files connector: a folder of the game server mounted into Outpost, or an SFTP server. It
// gives modules the capabilities files.read and, with writing allowed, files.write.
const { t, te } = useI18n();
const errorMessage = useErrorMessage();
const { server, reload } = useServerContext();
const blank = () => ({
  source: 'folder',
  path: '',
  writable: false,
  host: '',
  port: String(SFTP_DEFAULT_PORT),
  username: '',
  auth: 'password',
  secret: '',
  passphrase: '',
  remotePath: '/',
});
const form = reactive(blank());
const stored = ref<FilesInfo | null>(null);
const root = ref('');
/** The host key the last test saw; saving pins it. */
const testedHostKey = ref<string | null>(null);
const saved = ref(false);
const result = ref<FilesTestResult | null>(null);
const error = ref<string>();
const busy = ref<'load' | 'test' | 'save' | 'remove' | null>('load');

const url = computed(() => `${API_PREFIX}/servers/${encodeURIComponent(server.value.id)}/files`);
const connected = computed(() => server.value.connectors.includes('files'));
const capabilities = computed(() =>
  server.value.capabilities.filter((capability) => capability.startsWith('files.')),
);
const isSftp = computed(() => form.source === 'sftp');
/** The stored SFTP settings while host, port and username stay the same. */
const storedSftp = computed(() => {
  const files = stored.value;
  return files?.source === 'sftp' &&
    files.host === form.host.trim() &&
    files.port === Number(form.port) &&
    files.username === form.username.trim()
    ? files
    : null;
});
const secretKept = computed(() => storedSftp.value?.auth === form.auth);
const hostKey = computed(() => testedHostKey.value ?? storedSftp.value?.hostKey ?? null);
const hostKeyChanged = computed(
  () =>
    testedHostKey.value !== null &&
    storedSftp.value !== null &&
    testedHostKey.value !== storedSftp.value.hostKey,
);

// Another host needs a new test before its key can be pinned.
watch([() => form.host, () => form.port, () => form.username], () => {
  testedHostKey.value = null;
});

const body = () =>
  isSftp.value
    ? {
        source: 'sftp',
        host: form.host.trim(),
        port: Number(form.port),
        username: form.username.trim(),
        auth: form.auth,
        ...(form.secret !== '' && { secret: form.secret }),
        ...(form.auth === 'key' && form.passphrase !== '' && { passphrase: form.passphrase }),
        path: form.remotePath.trim(),
        writable: form.writable,
      }
    : { source: 'folder', path: form.path.trim(), writable: form.writable };

async function load(): Promise<void> {
  const state = await apiFetch(url.value, filesStateSchema);
  root.value = state.root;
  stored.value = state.files;
  const files = state.files;
  if (files?.source === 'folder') {
    Object.assign(form, { source: 'folder', path: files.path, writable: files.writable });
  } else if (files?.source === 'sftp') {
    Object.assign(form, {
      source: 'sftp',
      host: files.host,
      port: String(files.port),
      username: files.username,
      auth: files.auth,
      remotePath: files.path,
      writable: files.writable,
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
    if (err instanceof SudoCancelled) return;
    // A refused save comes with the failed test, which shows the reason step by step.
    const failed = err instanceof ApiError && err.code === 'files_test_failed';
    const steps = failed ? filesTestResultSchema.safeParse(err.details) : undefined;
    if (steps?.success) {
      result.value = steps.data;
      if (steps.data.hostKey !== null) testedHostKey.value = steps.data.hostKey;
    } else {
      error.value = errorMessage(err);
    }
  } finally {
    busy.value = null;
  }
}

const test = () =>
  run('test', async () => {
    result.value = await apiSend('POST', `${url.value}/test`, body(), filesTestResultSchema);
    testedHostKey.value = result.value.hostKey;
  });

const save = () =>
  run('save', async () => {
    const pin =
      isSftp.value && testedHostKey.value !== null ? { hostKey: testedHostKey.value } : {};
    await withSudo(() => apiSend('PUT', url.value, { ...body(), ...pin }));
    Object.assign(form, { secret: '', passphrase: '' });
    result.value = null;
    testedHostKey.value = null;
    saved.value = true;
    await Promise.all([load(), reload(), loadServers()]);
  });

const remove = () =>
  run('remove', async () => {
    await withSudo(() => apiSend('DELETE', url.value));
    Object.assign(form, blank());
    stored.value = null;
    result.value = null;
    testedHostKey.value = null;
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
  <Card data-testid="files-card">
    <CardHeader>
      <CardTitle class="flex flex-wrap items-center gap-2">
        {{ t('servers.files.title') }}
        <Badge v-for="capability in capabilities" :key="capability" variant="outline">
          {{ capability }}
        </Badge>
      </CardTitle>
      <CardDescription>{{ t('servers.files.text') }}</CardDescription>
    </CardHeader>
    <CardContent>
      <div v-if="busy === 'load'" class="flex justify-center py-4"><Spinner /></div>
      <form v-else class="flex flex-col gap-4" @submit.prevent="save">
        <FieldGroup class="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel for="files-source">{{ t('servers.files.source') }}</FieldLabel>
            <Select v-model="form.source">
              <SelectTrigger id="files-source" class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="folder">{{ t('servers.files.folder') }}</SelectItem>
                <SelectItem value="sftp">{{ t('servers.files.sftp') }}</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <template v-if="!isSftp">
            <Field>
              <FieldLabel for="files-path">{{ t('servers.files.path') }}</FieldLabel>
              <div class="flex items-center gap-1">
                <span class="text-muted-foreground font-mono text-sm">{{ root }}/</span>
                <Input
                  id="files-path"
                  v-model="form.path"
                  class="font-mono"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="survival"
                  required
                />
              </div>
            </Field>
            <FieldDescription class="sm:col-span-2">
              {{ t('servers.files.pathHint', { root }) }}
            </FieldDescription>
          </template>

          <template v-else>
            <div class="hidden sm:block" />
            <Field>
              <FieldLabel for="files-host">{{ t('servers.files.host') }}</FieldLabel>
              <Input
                id="files-host"
                v-model="form.host"
                class="font-mono"
                autocomplete="off"
                spellcheck="false"
                placeholder="sftp.example.com"
                required
              />
            </Field>
            <Field>
              <FieldLabel for="files-port">{{ t('servers.files.port') }}</FieldLabel>
              <Input
                id="files-port"
                v-model="form.port"
                class="font-mono"
                inputmode="numeric"
                pattern="[0-9]{1,5}"
                required
              />
            </Field>
            <Field>
              <FieldLabel for="files-username">{{ t('servers.files.username') }}</FieldLabel>
              <Input
                id="files-username"
                v-model="form.username"
                autocomplete="off"
                spellcheck="false"
                required
              />
            </Field>
            <Field>
              <FieldLabel for="files-auth">{{ t('servers.files.auth') }}</FieldLabel>
              <Select v-model="form.auth">
                <SelectTrigger id="files-auth" class="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="password">{{ t('servers.files.authPassword') }}</SelectItem>
                  <SelectItem value="key">{{ t('servers.files.authKey') }}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field v-if="form.auth === 'password'" class="sm:col-span-2">
              <FieldLabel for="files-secret">{{ t('servers.files.password') }}</FieldLabel>
              <Input
                id="files-secret"
                v-model="form.secret"
                type="password"
                autocomplete="new-password"
                :placeholder="secretKept ? t('servers.files.secretKept') : ''"
                :required="!secretKept"
              />
            </Field>
            <template v-else>
              <Field class="sm:col-span-2">
                <FieldLabel for="files-secret">{{ t('servers.files.privateKey') }}</FieldLabel>
                <Textarea
                  id="files-secret"
                  v-model="form.secret"
                  class="font-mono text-xs"
                  rows="4"
                  spellcheck="false"
                  :placeholder="
                    secretKept
                      ? t('servers.files.secretKept')
                      : '-----BEGIN OPENSSH PRIVATE KEY-----'
                  "
                  :required="!secretKept"
                />
                <FieldDescription>{{ t('servers.files.privateKeyHint') }}</FieldDescription>
              </Field>
              <Field class="sm:col-span-2">
                <FieldLabel for="files-passphrase">{{ t('servers.files.passphrase') }}</FieldLabel>
                <Input
                  id="files-passphrase"
                  v-model="form.passphrase"
                  type="password"
                  autocomplete="new-password"
                />
              </Field>
            </template>
            <Field class="sm:col-span-2">
              <FieldLabel for="files-remote-path">{{ t('servers.files.remotePath') }}</FieldLabel>
              <Input
                id="files-remote-path"
                v-model="form.remotePath"
                class="font-mono"
                autocomplete="off"
                spellcheck="false"
                placeholder="/"
                required
              />
              <FieldDescription>{{ t('servers.files.remotePathHint') }}</FieldDescription>
            </Field>
          </template>

          <Field orientation="horizontal" class="sm:col-span-2">
            <Switch id="files-writable" v-model="form.writable" />
            <div class="flex flex-col gap-1">
              <FieldLabel for="files-writable">{{ t('servers.files.writable') }}</FieldLabel>
              <FieldDescription>{{ t('servers.files.writableHint') }}</FieldDescription>
            </div>
          </Field>
        </FieldGroup>

        <div
          v-if="isSftp && hostKey"
          class="flex flex-col gap-1 rounded-lg border p-3 text-sm"
          data-testid="files-host-key"
        >
          <span class="flex items-center gap-2 font-medium">
            <KeyRoundIcon class="size-4" aria-hidden="true" />
            {{ t('servers.files.hostKey') }}
          </span>
          <code class="font-mono text-xs break-all">{{ hostKey }}</code>
          <span class="text-muted-foreground">{{ t('servers.files.hostKeyHint') }}</span>
          <span v-if="hostKeyChanged" class="text-destructive">
            {{ t('servers.files.hostKeyChanged') }}
          </span>
        </div>

        <ul v-if="result" class="flex flex-col gap-2 text-sm" data-testid="files-test">
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
            <div class="flex min-w-0 flex-col">
              <span>{{ t(`servers.files.steps.${step.step}`) }}</span>
              <span v-if="step.ok === false" class="text-destructive">{{
                describeError(step.error)
              }}</span>
              <code v-if="step.detail" class="text-muted-foreground text-xs break-all">{{
                step.detail
              }}</code>
            </div>
          </li>
        </ul>

        <Alert v-if="saved">
          <AlertDescription>{{ t('servers.files.saved') }}</AlertDescription>
        </Alert>
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <div class="flex flex-wrap gap-2">
          <Button type="button" variant="outline" :disabled="busy !== null" @click="test">
            <Spinner v-if="busy === 'test'" />
            {{ t('servers.files.test') }}
          </Button>
          <Button type="submit" :disabled="busy !== null">
            <Spinner v-if="busy === 'save'" />
            {{ t('servers.files.save') }}
          </Button>
          <Button
            v-if="connected"
            type="button"
            variant="ghost"
            :disabled="busy !== null"
            @click="remove"
          >
            {{ t('servers.files.remove') }}
          </Button>
        </div>
      </form>
    </CardContent>
  </Card>
</template>
