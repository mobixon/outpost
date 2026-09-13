<script setup lang="ts">
import { CircleAlertIcon, EllipsisIcon, InfoIcon, PlusIcon } from '@lucide/vue';
import { serverPluginApiPath } from '@outpost/shared';
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@outpost/ui';
import { ApiError, apiFetch, apiSend, useServerContext } from '@outpost/web-plugin-api';
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  isValidCron,
  isValidTimezone,
  MAX_MESSAGE_LENGTH,
  MAX_TASK_LINES,
  nextRuns,
  normalizeLines,
  parseMessage,
  runListSchema,
  runSchema,
  RUNS_KEPT,
  SCHEDULER_PLUGIN_ID,
  SchedulerPermission,
  TASK_TYPE_PERMISSION,
  taskListSchema,
  taskSchema,
  type Run,
  type Task,
  type TaskType,
} from '../shared.js';
import { describeCron } from './describe.js';

const REFRESH_MS = 30_000;
const PRESETS = [
  { key: 'every15', cron: '*/15 * * * *' },
  { key: 'hourly', cron: '0 * * * *' },
  { key: 'daily', cron: '0 4 * * *' },
  { key: 'weekly', cron: '0 4 * * 1' },
] as const;

interface Form {
  name: string;
  type: TaskType;
  cron: string;
  timezone: string;
  lines: string;
  enabled: boolean;
  onlyWithPlayers: boolean;
}

const { t, te, locale } = useI18n();
const { server } = useServerContext();
const can = (permission: string) => server.value.permissions.includes(permission);
const canManage = computed(() => can(SchedulerPermission.manage));
/** Tasks need the permission of what they do, besides managing tasks. */
const canType = (type: TaskType) => canManage.value && can(TASK_TYPE_PERMISSION[type]);
const url = (path: string) => serverPluginApiPath(server.value.id, SCHEDULER_PLUGIN_ID, path);

const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const timezones = Intl.supportedValuesOf('timeZone');

const tasks = ref<Task[] | null>(null);
const message = ref<{ kind: 'info' | 'error'; text: string } | null>(null);
const busy = ref(false);
const history = ref<{ task: Task; runs: Run[] } | null>(null);
const deleting = ref<Task | null>(null);

function emptyForm(): Form {
  const type: TaskType = canType('command') ? 'command' : 'announcement';
  return {
    name: '',
    type,
    cron: '0 4 * * *',
    timezone: browserZone,
    lines: '',
    enabled: true,
    onlyWithPlayers: type === 'announcement',
  };
}

const editor = reactive<{ open: boolean; id: string | null; error: string | null; form: Form }>({
  open: false,
  id: null,
  error: null,
  form: emptyForm(),
});

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const key = `errors.${err.code}`;
    return te(key) ? t(key) : err.message;
  }
  return te('errors.network') ? t('errors.network') : String(err);
}

function reasonText(reason: string | null): string {
  if (reason === null) return '';
  if (te(`scheduler.reasons.${reason}`)) return t(`scheduler.reasons.${reason}`);
  return te(`errors.${reason}`) ? t(`errors.${reason}`) : reason;
}

const runText = (run: Run) =>
  [t(`scheduler.status.${run.status}`), reasonText(run.reason)].filter(Boolean).join(': ');
const triggerText = (run: Run) =>
  run.trigger === 'schedule'
    ? t('scheduler.trigger.schedule')
    : run.triggeredBy === null
      ? t('scheduler.trigger.manual')
      : t('scheduler.trigger.manualBy', { user: run.triggeredBy });
const statusVariant = (run: Run) =>
  run.status === 'ok' ? 'secondary' : run.status === 'failed' ? 'destructive' : 'outline';

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' });
const formatIn = (date: Date, timeZone: string) =>
  date.toLocaleString(locale.value, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

async function load(): Promise<void> {
  try {
    tasks.value = (await apiFetch(url('/tasks'), taskListSchema)).tasks;
  } catch (err) {
    message.value = { kind: 'error', text: describeError(err) };
  }
}

function openEditor(task?: Task): void {
  editor.id = task?.id ?? null;
  editor.error = null;
  editor.form = task
    ? {
        name: task.name,
        type: task.type,
        cron: task.cron,
        timezone: task.timezone,
        lines: task.lines.join('\n'),
        enabled: task.enabled,
        onlyWithPlayers: task.onlyWithPlayers,
      }
    : emptyForm();
  editor.open = true;
}

const formLines = computed(() => normalizeLines(editor.form.type, editor.form.lines.split('\n')));
const cronValid = computed(() => isValidCron(editor.form.cron.trim()));
const zoneValid = computed(() => isValidTimezone(editor.form.timezone.trim()));
const cronText = computed(() =>
  cronValid.value ? describeCron(editor.form.cron.trim(), locale.value) : null,
);
const upcoming = computed(() => {
  if (!cronValid.value || !zoneValid.value) return [];
  const zone = editor.form.timezone.trim();
  return nextRuns(editor.form.cron.trim(), zone, 5).map((date) => formatIn(date, zone));
});
const stopWarning = computed(
  () => editor.form.type === 'command' && formLines.value.some((line) => /^stop\b/i.test(line)),
);
const formValid = computed(
  () =>
    editor.form.name.trim() !== '' &&
    cronValid.value &&
    zoneValid.value &&
    formLines.value.length > 0 &&
    formLines.value.length <= MAX_TASK_LINES,
);

function setType(value: unknown): void {
  if (value !== 'command' && value !== 'announcement') return;
  editor.form.type = value;
}

async function save(): Promise<void> {
  if (busy.value || !formValid.value) return;
  busy.value = true;
  editor.error = null;
  const body = {
    ...editor.form,
    name: editor.form.name.trim(),
    cron: editor.form.cron.trim(),
    timezone: editor.form.timezone.trim(),
    lines: editor.form.lines.split('\n'),
  };
  try {
    if (editor.id === null) await apiSend('POST', url('/tasks'), body, taskSchema);
    else await apiSend('PUT', url(`/tasks/${editor.id}`), body, taskSchema);
    editor.open = false;
    message.value = { kind: 'info', text: t('scheduler.saved') };
    await load();
  } catch (err) {
    editor.error = describeError(err);
  } finally {
    busy.value = false;
  }
}

async function setEnabled(task: Task, enabled: boolean): Promise<void> {
  const { name, type, cron, timezone, lines, onlyWithPlayers } = task;
  try {
    await apiSend(
      'PUT',
      url(`/tasks/${task.id}`),
      { name, type, cron, timezone, lines, onlyWithPlayers, enabled },
      taskSchema,
    );
    await load();
  } catch (err) {
    message.value = { kind: 'error', text: describeError(err) };
  }
}

async function runNow(task: Task): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  message.value = null;
  try {
    const run = await apiSend('POST', url(`/tasks/${task.id}/run`), {}, runSchema);
    message.value = {
      kind: run.status === 'failed' ? 'error' : 'info',
      text: `${task.name} — ${runText(run)}`,
    };
    await load();
  } catch (err) {
    message.value = { kind: 'error', text: describeError(err) };
  } finally {
    busy.value = false;
  }
}

async function showHistory(task: Task): Promise<void> {
  try {
    const { runs } = await apiFetch(url(`/tasks/${task.id}/runs`), runListSchema);
    history.value = { task, runs };
  } catch (err) {
    message.value = { kind: 'error', text: describeError(err) };
  }
}

async function remove(): Promise<void> {
  const task = deleting.value;
  if (task === null || busy.value) return;
  busy.value = true;
  try {
    await apiSend('DELETE', url(`/tasks/${task.id}`));
    deleting.value = null;
    await load();
  } catch (err) {
    message.value = { kind: 'error', text: describeError(err) };
  } finally {
    busy.value = false;
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void load();
  timer = setInterval(() => void load(), REFRESH_MS);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-center gap-2">
      <p class="text-muted-foreground text-sm">{{ t('scheduler.intro') }}</p>
      <div class="flex-1" />
      <Button v-if="canType('command') || canType('announcement')" @click="openEditor()">
        <PlusIcon />
        {{ t('scheduler.new') }}
      </Button>
    </div>

    <Alert
      v-if="message"
      :variant="message.kind === 'error' ? 'destructive' : 'default'"
      role="status"
    >
      <CircleAlertIcon v-if="message.kind === 'error'" />
      <InfoIcon v-else />
      <AlertDescription data-testid="scheduler-message">{{ message.text }}</AlertDescription>
    </Alert>

    <div v-if="tasks === null" class="flex justify-center py-8"><Spinner class="size-6" /></div>

    <Card v-else-if="tasks.length === 0">
      <CardHeader>
        <CardTitle>{{ t('scheduler.empty') }}</CardTitle>
        <CardDescription>{{ t('scheduler.emptyHint') }}</CardDescription>
      </CardHeader>
    </Card>

    <ul v-else class="flex flex-col gap-4" data-testid="scheduler-tasks">
      <li v-for="task in tasks" :key="task.id">
        <Card>
          <CardHeader class="flex flex-row items-start gap-3">
            <div class="flex min-w-0 flex-1 flex-col gap-1.5">
              <CardTitle class="flex flex-wrap items-center gap-2">
                <span class="break-words">{{ task.name }}</span>
                <Badge variant="secondary">{{ t(`scheduler.types.${task.type}`) }}</Badge>
                <Badge v-if="!task.enabled" variant="outline">{{ t('scheduler.disabled') }}</Badge>
              </CardTitle>
              <CardDescription class="flex flex-wrap gap-x-2">
                <span>{{ describeCron(task.cron, locale) ?? task.cron }}</span>
                <span class="font-mono">{{ task.cron }}</span>
                <span>{{ task.timezone }}</span>
              </CardDescription>
            </div>
            <Switch
              v-if="canType(task.type)"
              :model-value="task.enabled"
              :aria-label="t('scheduler.enabledFor', { name: task.name })"
              class="mt-1"
              @update:model-value="(value: boolean) => setEnabled(task, value)"
            />
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  :disabled="busy"
                  :aria-label="t('scheduler.actions.menu', { name: task.name })"
                >
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-48">
                <DropdownMenuItem v-if="canType(task.type)" @select="runNow(task)">
                  {{ t('scheduler.actions.run') }}
                </DropdownMenuItem>
                <DropdownMenuItem v-if="canType(task.type)" @select="openEditor(task)">
                  {{ t('scheduler.actions.edit') }}
                </DropdownMenuItem>
                <DropdownMenuItem @select="showHistory(task)">
                  {{ t('scheduler.actions.history') }}
                </DropdownMenuItem>
                <DropdownMenuItem
                  v-if="canType(task.type)"
                  variant="destructive"
                  @select="deleting = task"
                >
                  {{ t('scheduler.actions.delete') }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardHeader>
          <CardContent class="flex flex-col gap-3 text-sm">
            <ul class="bg-muted/50 flex flex-col gap-0.5 rounded-md px-3 py-2 font-mono text-xs">
              <li v-for="(line, index) in task.lines.slice(0, 3)" :key="index" class="truncate">
                {{ task.type === 'command' ? `/${line}` : line }}
              </li>
              <li v-if="task.lines.length > 3" class="text-muted-foreground">
                {{ t('scheduler.moreLines', { count: task.lines.length - 3 }) }}
              </li>
            </ul>
            <div class="text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
              <span>
                {{ t('scheduler.next') }}:
                {{ task.nextRun ? formatTime(task.nextRun) : t('scheduler.never') }}
              </span>
              <span v-if="task.lastRun" class="flex flex-wrap items-center gap-1.5">
                {{ t('scheduler.last') }}: {{ formatTime(task.lastRun.startedAt) }}
                <Badge :variant="statusVariant(task.lastRun)">{{ runText(task.lastRun) }}</Badge>
              </span>
              <span v-if="task.onlyWithPlayers">{{ t('scheduler.onlyWithPlayers') }}</span>
            </div>
          </CardContent>
        </Card>
      </li>
    </ul>

    <Dialog
      :open="editor.open"
      @update:open="
        (value: boolean) => {
          editor.open = value;
        }
      "
    >
      <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{{ editor.id ? t('scheduler.edit') : t('scheduler.new') }}</DialogTitle>
        </DialogHeader>
        <form class="flex flex-col gap-5" @submit.prevent="save">
          <FieldGroup class="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel for="task-name">{{ t('scheduler.form.name') }}</FieldLabel>
              <Input id="task-name" v-model="editor.form.name" maxlength="80" />
            </Field>
            <Field>
              <FieldLabel for="task-type">{{ t('scheduler.form.type') }}</FieldLabel>
              <Select :model-value="editor.form.type" @update:model-value="setType">
                <SelectTrigger id="task-type" class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="command" :disabled="!canType('command')">
                    {{ t('scheduler.types.command') }}
                  </SelectItem>
                  <SelectItem value="announcement" :disabled="!canType('announcement')">
                    {{ t('scheduler.types.announcement') }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>

          <Field>
            <FieldLabel for="task-lines">
              {{
                editor.form.type === 'command'
                  ? t('scheduler.form.commands')
                  : t('scheduler.form.messages')
              }}
            </FieldLabel>
            <Textarea
              id="task-lines"
              v-model="editor.form.lines"
              rows="4"
              class="font-mono"
              spellcheck="false"
            />
            <FieldDescription>
              {{
                editor.form.type === 'command'
                  ? t('scheduler.form.commandsHint', { max: MAX_TASK_LINES })
                  : t('scheduler.form.messagesHint', {
                      max: MAX_TASK_LINES,
                      length: MAX_MESSAGE_LENGTH,
                    })
              }}
            </FieldDescription>
            <div
              v-if="editor.form.type === 'announcement' && formLines.length > 0"
              class="flex flex-col gap-1 rounded-md border border-white/10 bg-neutral-900 px-3 py-2 font-mono text-sm text-white"
              :aria-label="t('scheduler.form.preview')"
            >
              <p v-for="(line, index) in formLines" :key="index" class="break-words">
                <span
                  v-for="(part, partIndex) in parseMessage(line)"
                  :key="partIndex"
                  :style="{ color: part.color?.hex }"
                  :class="{
                    'font-bold': part.bold,
                    italic: part.italic,
                    underline: part.underlined,
                    'line-through': part.strikethrough,
                  }"
                  >{{ part.text }}</span
                >
              </p>
            </div>
            <Alert v-if="stopWarning">
              <CircleAlertIcon />
              <AlertDescription>{{ t('scheduler.form.stopWarning') }}</AlertDescription>
            </Alert>
          </Field>

          <FieldGroup class="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel for="task-cron">{{ t('scheduler.form.schedule') }}</FieldLabel>
              <Input
                id="task-cron"
                v-model="editor.form.cron"
                class="font-mono"
                autocomplete="off"
                spellcheck="false"
                :aria-invalid="!cronValid"
              />
              <FieldDescription>
                {{
                  cronValid
                    ? (cronText ?? t('scheduler.form.scheduleHint'))
                    : t('scheduler.form.invalidCron')
                }}
              </FieldDescription>
              <div class="flex flex-wrap gap-1.5">
                <Button
                  v-for="preset in PRESETS"
                  :key="preset.key"
                  type="button"
                  size="sm"
                  variant="outline"
                  @click="editor.form.cron = preset.cron"
                >
                  {{ t(`scheduler.form.presets.${preset.key}`) }}
                </Button>
              </div>
            </Field>
            <Field>
              <FieldLabel for="task-timezone">{{ t('scheduler.form.timezone') }}</FieldLabel>
              <Input
                id="task-timezone"
                v-model="editor.form.timezone"
                list="scheduler-timezones"
                autocomplete="off"
                :aria-invalid="!zoneValid"
              />
              <datalist id="scheduler-timezones">
                <option v-for="zone in timezones" :key="zone" :value="zone" />
              </datalist>
              <FieldDescription v-if="!zoneValid">
                {{ t('scheduler.form.invalidTimezone') }}
              </FieldDescription>
              <div v-else class="text-sm">
                <p class="text-muted-foreground mb-1">
                  {{ t('scheduler.form.nextRuns', { zone: editor.form.timezone.trim() }) }}
                </p>
                <p v-if="cronValid && upcoming.length === 0" class="text-muted-foreground">
                  {{ t('scheduler.form.noRuns') }}
                </p>
                <ul v-else class="flex flex-col gap-0.5" data-testid="scheduler-next-runs">
                  <li v-for="time in upcoming" :key="time">{{ time }}</li>
                </ul>
              </div>
            </Field>
          </FieldGroup>

          <div class="flex flex-col gap-3">
            <div class="flex items-center gap-3">
              <Switch id="task-players" v-model="editor.form.onlyWithPlayers" />
              <FieldLabel for="task-players">{{ t('scheduler.onlyWithPlayers') }}</FieldLabel>
            </div>
            <div class="flex items-center gap-3">
              <Switch id="task-enabled" v-model="editor.form.enabled" />
              <FieldLabel for="task-enabled">{{ t('scheduler.form.enabled') }}</FieldLabel>
            </div>
          </div>

          <Alert v-if="editor.error" variant="destructive">
            <CircleAlertIcon />
            <AlertDescription>{{ editor.error }}</AlertDescription>
          </Alert>

          <DialogFooter>
            <Button type="button" variant="outline" @click="editor.open = false">
              {{ t('scheduler.form.cancel') }}
            </Button>
            <Button type="submit" :disabled="busy || !formValid">
              {{ t('scheduler.form.save') }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog
      :open="history !== null"
      @update:open="
        (value: boolean) => {
          if (!value) history = null;
        }
      "
    >
      <DialogContent v-if="history" class="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{{ t('scheduler.history.title', { name: history.task.name }) }}</DialogTitle>
        </DialogHeader>
        <p v-if="history.runs.length === 0" class="text-muted-foreground text-sm">
          {{ t('scheduler.history.empty') }}
        </p>
        <div v-else class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{{ t('scheduler.history.time') }}</TableHead>
                <TableHead>{{ t('scheduler.history.status') }}</TableHead>
                <TableHead>{{ t('scheduler.history.output') }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="run in history.runs" :key="run.id" class="align-top">
                <TableCell class="whitespace-nowrap">
                  {{ formatTime(run.startedAt) }}
                  <div class="text-muted-foreground text-xs">{{ triggerText(run) }}</div>
                </TableCell>
                <TableCell>
                  <Badge :variant="statusVariant(run)">{{ runText(run) }}</Badge>
                </TableCell>
                <TableCell>
                  <pre
                    v-if="run.output"
                    class="max-w-md font-mono text-xs break-words whitespace-pre-wrap"
                    >{{ run.output }}</pre>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <p class="text-muted-foreground text-xs">
          {{ t('scheduler.history.kept', { count: RUNS_KEPT }) }}
        </p>
      </DialogContent>
    </Dialog>

    <AlertDialog
      :open="deleting !== null"
      @update:open="
        (value: boolean) => {
          if (!value) deleting = null;
        }
      "
    >
      <AlertDialogContent v-if="deleting">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t('scheduler.delete.title', { name: deleting.name }) }}
          </AlertDialogTitle>
          <AlertDialogDescription>{{ t('scheduler.delete.text') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('scheduler.form.cancel') }}</AlertDialogCancel>
          <AlertDialogAction :disabled="busy" @click="remove">
            {{ t('scheduler.delete.confirm') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
