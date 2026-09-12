<script setup lang="ts">
import { SendIcon, TerminalIcon, Trash2Icon } from '@lucide/vue';
import { serverPluginApiPath } from '@outpost/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Spinner,
} from '@outpost/ui';
import { ApiError, apiSend, useServerContext } from '@outpost/web-plugin-api';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { CONSOLE_PLUGIN_ID, commandResultSchema, ConsolePermission } from '../shared.js';
import { complete } from './commands.js';
import { parseFormatting } from './formatting.js';

interface Entry {
  id: number;
  kind: 'command' | 'reply' | 'chat' | 'error';
  text: string;
}

const MAX_ENTRIES = 300;
const MAX_HISTORY = 100;

const { t, te } = useI18n();
const { server } = useServerContext();
const canExecute = computed(() => server.value.permissions.includes(ConsolePermission.execute));
const canChat = computed(() => server.value.permissions.includes(ConsolePermission.chat));

// The transcript lives for the browser tab; the command history is kept per server.
const transcriptKey = computed(() => `outpost.console.${server.value.id}`);
const historyKey = computed(() => `outpost.console.history.${server.value.id}`);
const entries = ref<Entry[]>(load<Entry[]>(sessionStorage, transcriptKey.value) ?? []);
const history = ref<string[]>(load<string[]>(localStorage, historyKey.value) ?? []);
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

watch(entries, (value) => store(sessionStorage, transcriptKey.value, value), { deep: true });

let nextId = Math.max(0, ...entries.value.map((entry) => entry.id)) + 1;
async function add(kind: Entry['kind'], text: string): Promise<void> {
  entries.value = [...entries.value, { id: nextId++, kind, text }].slice(-MAX_ENTRIES);
  await nextTick();
  output.value?.scrollTo({ top: output.value.scrollHeight });
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const key = `errors.${err.code}`;
    return te(key) ? t(key) : err.message;
  }
  return te('errors.network') ? t('errors.network') : String(err);
}

const path = (url: string) => serverPluginApiPath(server.value.id, CONSOLE_PLUGIN_ID, url);

async function run(): Promise<void> {
  const text = command.value.trim();
  if (text === '' || busy.value) return;
  busy.value = true;
  matches.value = [];
  history.value = [text, ...history.value.filter((entry) => entry !== text)].slice(0, MAX_HISTORY);
  store(localStorage, historyKey.value, history.value);
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
    command.value = historyIndex === -1 ? '' : (history.value[historyIndex] ?? '');
  }
}

const clear = () => {
  entries.value = [];
};
</script>

<template>
  <div class="flex flex-col gap-4">
    <Card class="py-0">
      <CardContent class="p-0">
        <div
          ref="output"
          class="h-[26rem] overflow-auto rounded-xl bg-zinc-950 p-4 font-mono text-sm text-zinc-100"
          role="log"
          :aria-label="t('console.output')"
          data-testid="console-output"
        >
          <p v-if="entries.length === 0" class="flex items-start gap-2 text-zinc-400">
            <TerminalIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {{ t('console.empty') }}
          </p>
          <div v-for="entry in entries" :key="entry.id" class="whitespace-pre-wrap break-words">
            <span v-if="entry.kind === 'command'" class="text-sky-300">&gt; {{ entry.text }}</span>
            <span v-else-if="entry.kind === 'chat'" class="text-zinc-400"
              >[Web] {{ entry.text }}</span
            >
            <span v-else-if="entry.kind === 'error'" class="text-red-400">{{ entry.text }}</span>
            <template v-else>
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
            </template>
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

    <Alert v-if="!canExecute && !canChat">
      <AlertDescription>{{ t('servers.noAccess') }}</AlertDescription>
    </Alert>
  </div>
</template>
