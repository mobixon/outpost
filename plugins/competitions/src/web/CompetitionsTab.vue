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
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Spinner,
} from '@outpost/ui';
import { apiFetch, apiSend, useServerContext } from '@outpost/web-plugin-api';
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  COMPETITIONS_PLUGIN_ID,
  CompetitionsPermission,
  eventListSchema,
  eventSchema,
  type CompetitionEvent,
} from '../shared.js';
import EventDetail from './EventDetail.vue';
import EventEditor from './EventEditor.vue';
import { describe, formatTime, metricText } from './util.js';

const REFRESH_MS = 30_000;

const { t, te, locale } = useI18n();
const { server } = useServerContext();
const url = (path: string) => serverPluginApiPath(server.value.id, COMPETITIONS_PLUGIN_ID, path);
const canManage = computed(() => server.value.permissions.includes(CompetitionsPermission.manage));

const events = ref<CompetitionEvent[] | null>(null);
const message = ref<{ kind: 'info' | 'error'; text: string } | null>(null);
const busy = ref(false);
const selected = ref<string | null>(null);
const editing = ref<{ open: boolean; event: CompetitionEvent | null; clone: boolean }>({
  open: false,
  event: null,
  clone: false,
});
const cancelling = ref<CompetitionEvent | null>(null);
const deleting = ref<CompetitionEvent | null>(null);
const detail = useTemplateRef('detail');

async function load(): Promise<void> {
  try {
    events.value = (await apiFetch(url('/events'), eventListSchema)).events;
  } catch (err) {
    message.value = { kind: 'error', text: describe(err, t, te) };
  }
}

function openEditor(event: CompetitionEvent | null, clone = false): void {
  editing.value = { open: true, event, clone };
}

async function saved(): Promise<void> {
  message.value = { kind: 'info', text: t('competitions.saved') };
  await load();
  await detail.value?.reload();
}

/** Runs an action on an event, then shows what is new. */
async function act(action: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  message.value = null;
  try {
    await action();
    await load();
    await detail.value?.reload();
  } catch (err) {
    message.value = { kind: 'error', text: describe(err, t, te) };
  } finally {
    busy.value = false;
  }
}

async function cancel(): Promise<void> {
  const event = cancelling.value;
  if (event === null) return;
  cancelling.value = null;
  await act(() =>
    apiSend('POST', url(`/events/${event.id}/cancel`), {}, eventSchema).then(() => undefined),
  );
}

async function remove(): Promise<void> {
  const event = deleting.value;
  if (event === null) return;
  deleting.value = null;
  await act(async () => {
    await apiSend('DELETE', url(`/events/${event.id}`));
    if (selected.value === event.id) selected.value = null;
  });
}

const editable = (event: CompetitionEvent) =>
  event.state === 'scheduled' || event.state === 'active';
const deletable = (event: CompetitionEvent) =>
  event.state !== 'active' && event.state !== 'finishing';
const period = (event: CompetitionEvent) =>
  t('competitions.period', {
    start: formatTime(event.startsAt, locale.value, event.timezone),
    end: formatTime(event.endsAt, locale.value, event.timezone),
  });
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void load();
  timer = setInterval(() => void load(), REFRESH_MS);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="flex flex-col gap-6">
    <Alert
      v-if="message"
      :variant="message.kind === 'error' ? 'destructive' : 'default'"
      role="status"
    >
      <CircleAlertIcon v-if="message.kind === 'error'" />
      <InfoIcon v-else />
      <AlertDescription data-testid="competitions-message">{{ message.text }}</AlertDescription>
    </Alert>

    <template v-if="selected !== null">
      <EventDetail
        :key="selected"
        ref="detail"
        :event-id="selected"
        @back="selected = null"
        @edit="openEditor(events?.find((entry) => entry.id === selected) ?? null)"
        @clone="openEditor(events?.find((entry) => entry.id === selected) ?? null, true)"
      />
    </template>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <p class="text-muted-foreground text-sm">{{ t('competitions.intro') }}</p>
        <div class="flex-1" />
        <Button v-if="canManage" @click="openEditor(null)">
          <PlusIcon />
          {{ t('competitions.new') }}
        </Button>
      </div>

      <div v-if="events === null" class="flex justify-center py-8"><Spinner class="size-6" /></div>

      <Card v-else-if="events.length === 0">
        <CardHeader>
          <CardTitle>{{ t('competitions.empty') }}</CardTitle>
          <CardDescription>{{ t('competitions.emptyHint') }}</CardDescription>
        </CardHeader>
      </Card>

      <ul v-else class="flex flex-col gap-4" data-testid="competitions-list">
        <li v-for="event in events" :key="event.id">
          <Card>
            <CardHeader class="flex flex-row items-start gap-3">
              <button
                type="button"
                class="flex min-w-0 flex-1 flex-col gap-1.5 text-left"
                @click="selected = event.id"
              >
                <CardTitle class="flex flex-wrap items-center gap-2">
                  <span class="break-words">{{ event.name }}</span>
                  <Badge :variant="event.state === 'active' ? 'default' : 'secondary'">
                    {{ t(`competitions.states.${event.state}`) }}
                  </Badge>
                </CardTitle>
                <CardDescription class="flex flex-col gap-0.5">
                  <span>{{ period(event) }}</span>
                  <span>{{ metricText(event.metric, t) }}</span>
                </CardDescription>
              </button>
              <DropdownMenu v-if="canManage">
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon"
                    :disabled="busy"
                    :aria-label="t('competitions.actions.menu', { name: event.name })"
                  >
                    <EllipsisIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="w-48">
                  <DropdownMenuItem @select="selected = event.id">
                    {{ t('competitions.actions.open') }}
                  </DropdownMenuItem>
                  <DropdownMenuItem v-if="editable(event)" @select="openEditor(event)">
                    {{ t('competitions.actions.edit') }}
                  </DropdownMenuItem>
                  <DropdownMenuItem @select="openEditor(event, true)">
                    {{ t('competitions.actions.clone') }}
                  </DropdownMenuItem>
                  <DropdownMenuItem v-if="editable(event)" @select="cancelling = event">
                    {{ t('competitions.actions.cancel') }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    v-if="deletable(event)"
                    variant="destructive"
                    @select="deleting = event"
                  >
                    {{ t('competitions.actions.delete') }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardHeader>
          </Card>
        </li>
      </ul>
    </template>

    <EventEditor
      v-model:open="editing.open"
      :event="editing.event"
      :clone="editing.clone"
      @saved="saved"
    />

    <AlertDialog
      :open="cancelling !== null"
      @update:open="
        (value: boolean) => {
          if (!value) cancelling = null;
        }
      "
    >
      <AlertDialogContent v-if="cancelling">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t('competitions.cancel.title', { name: cancelling.name }) }}
          </AlertDialogTitle>
          <AlertDialogDescription>{{ t('competitions.cancel.text') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('competitions.cancel.keep') }}</AlertDialogCancel>
          <AlertDialogAction :disabled="busy" @click="cancel">
            {{ t('competitions.cancel.confirm') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

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
            {{ t('competitions.delete.title', { name: deleting.name }) }}
          </AlertDialogTitle>
          <AlertDialogDescription>{{ t('competitions.delete.text') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('competitions.form.cancel') }}</AlertDialogCancel>
          <AlertDialogAction :disabled="busy" @click="remove">
            {{ t('competitions.delete.confirm') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
