<script setup lang="ts">
import { CircleCheckIcon, CircleMinusIcon, CircleXIcon } from '@lucide/vue';
import {
  API_PREFIX,
  filesStateSchema,
  filesTestResultSchema,
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
} from '@outpost/ui';
import { ApiError, apiFetch, apiSend, useServerContext } from '@outpost/web-plugin-api';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { SudoCancelled, withSudo } from '../../account/sudo.js';
import { useErrorMessage } from '../../errors.js';
import { loadServers } from '../../servers.js';

// The Files connector: a folder of the game server mounted into Outpost. It gives modules the
// capabilities files.read and, with writing allowed, files.write.
const { t, te } = useI18n();
const errorMessage = useErrorMessage();
const { server, reload } = useServerContext();
const form = reactive({ source: 'folder', path: '', writable: false });
const root = ref('');
const saved = ref(false);
const result = ref<FilesTestResult | null>(null);
const error = ref<string>();
const busy = ref<'load' | 'test' | 'save' | 'remove' | null>('load');

const url = computed(() => `${API_PREFIX}/servers/${encodeURIComponent(server.value.id)}/files`);
const connected = computed(() => server.value.connectors.includes('files'));
const capabilities = computed(() =>
  server.value.capabilities.filter((capability) => capability.startsWith('files.')),
);
const body = () => ({ source: form.source, path: form.path.trim(), writable: form.writable });

async function load(): Promise<void> {
  const state = await apiFetch(url.value, filesStateSchema);
  root.value = state.root;
  if (state.files !== null) {
    Object.assign(form, { path: state.files.path, writable: state.files.writable });
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
    if (steps?.success) result.value = steps.data;
    else error.value = errorMessage(err);
  } finally {
    busy.value = null;
  }
}

const test = () =>
  run('test', async () => {
    result.value = await apiSend('POST', `${url.value}/test`, body(), filesTestResultSchema);
  });

const save = () =>
  run('save', async () => {
    await withSudo(() => apiSend('PUT', url.value, body()));
    result.value = null;
    saved.value = true;
    await Promise.all([reload(), loadServers()]);
  });

const remove = () =>
  run('remove', async () => {
    await withSudo(() => apiSend('DELETE', url.value));
    Object.assign(form, { path: '', writable: false });
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
                <SelectItem value="sftp" disabled>
                  {{ t('servers.files.sftp') }} · {{ t('servers.files.later') }}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
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
          <Field orientation="horizontal" class="sm:col-span-2">
            <Switch id="files-writable" v-model="form.writable" />
            <div class="flex flex-col gap-1">
              <FieldLabel for="files-writable">{{ t('servers.files.writable') }}</FieldLabel>
              <FieldDescription>{{ t('servers.files.writableHint') }}</FieldDescription>
            </div>
          </Field>
        </FieldGroup>

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
            <div class="flex flex-col">
              <span>{{ t(`servers.files.steps.${step.step}`) }}</span>
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
