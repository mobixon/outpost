<script setup lang="ts">
import { HistoryIcon, SendIcon, TerminalIcon, Trash2Icon } from '@lucide/vue';
import { serverPluginApiPath } from '@outpost/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Spinner,
} from '@outpost/ui';
import { ApiError, apiFetch, apiSend, useServerContext } from '@outpost/web-plugin-api';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  CONSOLE_PLUGIN_ID,
  commandResultSchema,
  ConsolePermission,
  historySchema,
  logLinesSchema,
  type HistoryEntry,
} from '../shared.js';
import { complete } from './commands.js';
import { parseFormatting } from './formatting.js';
import { logLevel, type LogLevel } from './log.js';

interface Entry {
  id: number;
  kind: 'command' | 'reply' | 'chat' | 'error' | 'log';
  text: string;
  level?: LogLevel;
}

type LiveState = 'connecting' | 'live' | 'reconnecting' | 'closed';

const MAX_ENTRIES = 1000;
/** Commands shown in the history menu. */
const MAX_HISTORY_SHOWN = 50;
const LEVEL_CLASS: Record<LogLevel, string> = {
  error: 'text-red-300',
  warn: 'text-amber-200',
  info: 'text-zinc-300',
};

const { t, te } = useI18n();
const { server } = useServerContext();
// Commands and chat go over RCON; the live log comes from the files.
const hasRcon = computed(() => server.value.capabilities.includes('commands.send'));
const canExecute = computed(
  () => hasRcon.value && server.value.permissions.includes(ConsolePermission.execute),
);
const canChat = computed(
  () => hasRcon.value && server.value.permissions.includes(ConsolePermission.chat),
);
// The live log needs the files of the server (logs.stream) and the right to read it.
const live = computed(
  () =>
    server.value.capabilities.includes('logs.stream') &&
    server.value.permissions.includes(ConsolePermission.read),
);
const liveState = ref<LiveState>('connecting');

// The commands and replies live for the browser tab; the log comes from the server again, and
// the command history is kept in the account of the user.
const transcriptKey = computed(() => `outpost.console.${server.value.id}`);
const entries = ref<Entry[]>(load<Entry[]>(sessionStorage, transcriptKey.value) ?? []);
const history = ref<HistoryEntry[]>([]);
let historyIndex = -1;
const command = ref('');
const matches = ref<string[]>([]);
const message = ref('');
const busy = ref(false);
const output = ref<HTMLElement>();

function load<T>(storage: Storage, key: string): T | undefined {
  try {
    const value = storage.getItem(key);
    return value === null ? undefined : (JSON.parse(value) as T);
  } catch {
    return undefined;
  }
}

function store(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or disabled; the console still works.
  }
}

watch(entries, (value) =>
  store(
    sessionStorage,
    transcriptKey.value,
    value.filter((entry) => entry.kind !== 'log'),
  ),
);

/** Whether the view follows new output: not while the user has scrolled up to read. */
function following(): boolean {
  const element = output.value;
  return (
    element === undefined || element.scrollHeight - element.scrollTop - element.clientHeight < 40
  );
}

let nextId = Math.max(0, ...entries.value.map((entry) => entry.id)) + 1;
async function append(items: Omit<Entry, 'id'>[], scroll = following()): Promise<void> {
  entries.value = [...entries.value, ...items.map((item) => ({ ...item, id: nextId++ }))].slice(
    -MAX_ENTRIES,
  );
  await nextTick();
  if (scroll) output.value?.scrollTo({ top: output.value.scrollHeight });
}
const add = (kind: Entry['kind'], text: string) => append([{ kind, text }], true);

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const key = `errors.${err.code}`;
    return te(key) ? t(key) : err.message;
  }
  return te('errors.network') ? t('errors.network') : String(err);
}

const path = (url: string) => serverPluginApiPath(server.value.id, CONSOLE_PLUGIN_ID, url);

// The browser reconnects by itself and gets only the lines it missed (Last-Event-ID).
let source: EventSource | undefined;
function follow(): void {
  source = new EventSource(path('/log'));
  source.addEventListener('lines', (event) => {
    let data: unknown;
    try {
      data = JSON.parse((event as MessageEvent<string>).data);
    } catch {
      return;
    }
    const lines = logLinesSchema.safeParse(data);
    if (!lines.success) return;
    void append(
      lines.data.map((line) => ({ kind: 'log', text: line.text, level: logLevel(line.text) })),
    );
  });
  source.addEventListener('ready', () => {
    liveState.value = 'live';
  });
  source.addEventListener('open', () => {
    if (liveState.value === 'reconnecting') liveState.value = 'live';
  });
  source.addEventListener('error', () => {
    liveState.value = source?.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting';
  });
}

async function loadHistory(): Promise<void> {
  if (!canExecute.value) return;
  try {
    history.value = (await apiFetch(path('/history'), historySchema)).commands;
  } catch {
    // Without the history the command line still works.
  }
}

onMounted(() => {
  if (live.value) follow();
  void loadHistory();
});
onBeforeUnmount(() => source?.close());

/** The history, narrowed to the commands that contain what is typed. */
const historyShown = computed(() => {
  const typed = command.value.trim().toLowerCase();
  const found =
    typed === ''
      ? history.value
      : history.value.filter((entry) => entry.command.toLowerCase().includes(typed));
  return found.slice(0, MAX_HISTORY_SHOWN);
});

const focusCommand = () => document.getElementById('console-command')?.focus();

function pick(entry: HistoryEntry): void {
  command.value = entry.command;
  matches.value = [];
  historyIndex = -1;
}

async function clearHistory(): Promise<void> {
  try {
    await apiSend('DELETE', path('/history'));
    history.value = [];
  } catch (err) {
    await add('error', describeError(err));
  }
}

async function run(): Promise<void> {
  const text = command.value.trim();
  if (text === '' || busy.value) return;
  busy.value = true;
  matches.value = [];
  historyIndex = -1;
  command.value = '';
  await add('command', text);
  try {
    const { reply } = await apiSend(
      'POST',
      path('/command'),
      { command: text },
      commandResultSchema,
    );
    await add('reply', reply === '' ? t('console.noReply') : reply);
  } catch (err) {
    await add('error', describeError(err));
  } finally {
    busy.value = false;
    void loadHistory();
  }
}

async function sendChat(): Promise<void> {
  const text = message.value.trim();
  if (text === '' || busy.value) return;
  busy.value = true;
  try {
    await apiSend('POST', path('/chat'), { message: text });
    message.value = '';
    await add('chat', text);
  } catch (err) {
    await add('error', describeError(err));
  } finally {
    busy.value = false;
  }
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Tab') {
    event.preventDefault();
    const result = complete(command.value);
    command.value = result.value;
    matches.value = result.matches.length > 1 ? result.matches.slice(0, 12) : [];
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    if (history.value.length === 0) return;
    event.preventDefault();
    historyIndex =
      event.key === 'ArrowUp'
        ? Math.min(historyIndex + 1, history.value.length - 1)
        : Math.max(historyIndex - 1, -1);
    command.value = historyIndex === -1 ? '' : (history.value[historyIndex]?.command ?? '');
  }
}

const clear = () => {
  entries.value = [];
};
</script>

<template>
  <div class="flex flex-col gap-4">
    <p
      v-if="live"
      class="text-muted-foreground flex items-center gap-2 text-sm"
      data-testid="console-live"
    >
      <span
        class="size-2 shrink-0 rounded-full"
        :class="
          liveState === 'live'
            ? 'bg-emerald-500'
            : liveState === 'closed'
              ? 'bg-destructive'
              : 'animate-pulse bg-amber-500'
        "
        aria-hidden="true"
      />
      {{ t(`console.liveState.${liveState}`) }}
    </p>

    <Card class="py-0">
      <CardContent class="p-0">
        <div
          ref="output"
          class="overflow-auto rounded-xl bg-zinc-950 p-4 font-mono text-sm text-zinc-100"
          :class="live ? 'h-[32rem]' : 'h-[26rem]'"
          role="log"
          :aria-label="t('console.output')"
          data-testid="console-output"
        >
          <p v-if="entries.length === 0" class="flex items-start gap-2 text-zinc-400">
            <TerminalIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {{ live ? t('console.emptyLive') : t('console.empty') }}
          </p>
          <div v-for="entry in entries" :key="entry.id" class="break-words whitespace-pre-wrap">
            <span v-if="entry.kind === 'command'" class="text-sky-300">&gt; {{ entry.text }}</span>
            <span v-else-if="entry.kind === 'chat'" class="text-zinc-400"
              >[Server] {{ entry.text }}</span
            >
            <span v-else-if="entry.kind === 'error'" class="text-red-400">{{ entry.text }}</span>
            <span v-else :class="entry.kind === 'log' ? LEVEL_CLASS[entry.level ?? 'info'] : ''">
              <span
                v-for="(segment, index) in parseFormatting(entry.text)"
                :key="index"
                :style="{ color: segment.color }"
                :class="{
                  'font-bold': segment.bold,
                  italic: segment.italic,
                  underline: segment.underline,
                  'line-through': segment.strikethrough,
                }"
                >{{ segment.text }}</span
              >
            </span>
          </div>
        </div>
      </CardContent>
    </Card>

    <form v-if="canExecute" class="flex flex-col gap-2" @submit.prevent="run">
      <Field>
        <FieldLabel for="console-command">{{ t('console.command') }}</FieldLabel>
        <div class="flex gap-2">
          <Input
            id="console-command"
            v-model="command"
            class="font-mono"
            autocomplete="off"
            spellcheck="false"
            placeholder="list"
            @keydown="onKey"
          />
          <DropdownMenu @update:open="(open: boolean) => open && loadHistory()">
            <DropdownMenuTrigger as-child>
              <Button
                type="button"
                variant="outline"
                size="icon"
                :aria-label="t('console.history')"
                :title="t('console.history')"
                data-testid="console-history"
              >
                <HistoryIcon />
              </Button>
            </DropdownMenuTrigger>
            <!-- The chosen command goes into the command line, ready to run or to change. -->
            <DropdownMenuContent
              align="end"
              class="max-h-80 w-80 overflow-y-auto"
              @close-auto-focus="
                (event: Event) => {
                  event.preventDefault();
                  focusCommand();
                }
              "
            >
              <DropdownMenuLabel>{{ t('console.history') }}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <p v-if="history.length === 0" class="text-muted-foreground px-2 py-1.5 text-sm">
                {{ t('console.historyEmpty') }}
              </p>
              <p
                v-else-if="historyShown.length === 0"
                class="text-muted-foreground px-2 py-1.5 text-sm"
              >
                {{ t('console.historyNoMatch') }}
              </p>
              <DropdownMenuItem
                v-for="entry in historyShown"
                :key="entry.id"
                class="font-mono"
                @select="pick(entry)"
              >
                <span class="truncate">{{ entry.command }}</span>
                <DropdownMenuShortcut v-if="entry.uses > 1">×{{ entry.uses }}</DropdownMenuShortcut>
              </DropdownMenuItem>
              <template v-if="history.length > 0">
                <DropdownMenuSeparator />
                <DropdownMenuItem class="text-destructive" @select="clearHistory">
                  <Trash2Icon />
                  {{ t('console.historyClear') }}
                </DropdownMenuItem>
              </template>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="submit" :disabled="busy || command.trim() === ''">
            <Spinner v-if="busy" />
            {{ t('console.run') }}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            :aria-label="t('console.clear')"
            :title="t('console.clear')"
            @click="clear"
          >
            <Trash2Icon />
          </Button>
        </div>
        <FieldDescription>{{ t('console.hint') }}</FieldDescription>
      </Field>
      <div v-if="matches.length > 0" class="flex flex-wrap gap-1 font-mono text-xs">
        <span v-for="match in matches" :key="match" class="bg-muted rounded px-2 py-0.5">
          {{ match }}
        </span>
      </div>
    </form>

    <form v-if="canChat" class="flex flex-col gap-2" @submit.prevent="sendChat">
      <FieldLabel for="console-chat">{{ t('console.chat') }}</FieldLabel>
      <div class="flex gap-2">
        <Input
          id="console-chat"
          v-model="message"
          maxlength="256"
          autocomplete="off"
          :placeholder="t('console.chatPlaceholder')"
        />
        <Button type="submit" variant="outline" :disabled="busy || message.trim() === ''">
          <SendIcon />
          {{ t('console.send') }}
        </Button>
      </div>
    </form>

    <Alert v-if="!canExecute && !canChat && !live">
      <AlertDescription>{{ t('servers.noAccess') }}</AlertDescription>
    </Alert>
  </div>
</template>
