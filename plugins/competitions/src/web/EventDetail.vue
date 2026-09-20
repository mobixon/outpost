<script setup lang="ts">
import {
  ArrowLeftIcon,
  BracesIcon,
  CircleAlertIcon,
  CopyIcon,
  PencilIcon,
  RefreshCwIcon,
} from '@lucide/vue';
import { parseMessage, serverPluginApiPath } from '@outpost/shared';
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
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@outpost/ui';
import { apiFetch, apiSend, useServerContext } from '@outpost/web-plugin-api';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatScore } from '../render.js';
import {
  COMPETITIONS_PLUGIN_ID,
  CompetitionsPermission,
  eventDetailSchema,
  type EventDetail,
  type RewardStatus,
} from '../shared.js';
import { copyEventJson, describe, eventText, formatSpan, formatTime } from './util.js';

const REFRESH_MS = 15_000;
/** A start later than this after the planned one is worth a warning. */
const LATE_START_MS = 2 * 60_000;

const props = defineProps<{ eventId: string }>();
const emit = defineEmits<{ back: []; edit: []; clone: []; loaded: [] }>();

const { t, te, locale } = useI18n();
const { server } = useServerContext();
const url = (path: string) => serverPluginApiPath(server.value.id, COMPETITIONS_PLUGIN_ID, path);
const can = (permission: string) => server.value.permissions.includes(permission);
const canManage = computed(() => can(CompetitionsPermission.manage));
const canRewards = computed(() => can(CompetitionsPermission.rewards));

const detail = ref<EventDetail | null>(null);
const confirmingCount = ref(false);
const copiedJson = ref(false);
const error = ref<string | null>(null);
const busy = ref(false);

async function load(): Promise<void> {
  try {
    detail.value = await apiFetch(url(`/events/${props.eventId}`), eventDetailSchema);
    error.value = null;
    emit('loaded');
  } catch (err) {
    error.value = describe(err, t, te);
  }
}

async function reward(status: RewardStatus, action: 'retry' | 'cancel'): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await apiSend('POST', url(`/events/${props.eventId}/rewards/${status.id}/${action}`), {});
    await load();
  } catch (err) {
    error.value = describe(err, t, te);
  } finally {
    busy.value = false;
  }
}

async function copyJson(): Promise<void> {
  if (event.value === null) return;
  if (await copyEventJson(event.value)) {
    copiedJson.value = true;
    setTimeout(() => {
      copiedJson.value = false;
    }, 2000);
  } else {
    error.value = t('competitions.detail.copyJsonFailed');
  }
}

/** Counts the standings now; the server saves the world first. */
async function countNow(): Promise<void> {
  confirmingCount.value = false;
  if (busy.value) return;
  busy.value = true;
  try {
    detail.value = await apiSend(
      'POST',
      url(`/events/${props.eventId}/count`),
      {},
      eventDetailSchema,
    );
    error.value = null;
  } catch (err) {
    error.value = describe(err, t, te);
  } finally {
    busy.value = false;
  }
}

const event = computed(() => detail.value?.event ?? null);
const countable = computed(
  () =>
    canManage.value && event.value?.state === 'active' && detail.value?.capabilities.stats === true,
);
const editable = computed(
  () => canManage.value && (event.value?.state === 'scheduled' || event.value?.state === 'active'),
);
const timeIn = (iso: string) => formatTime(iso, locale.value, event.value?.timezone);
/** The description without the `&` codes of its colors. */
const description = computed(() =>
  parseMessage(event.value?.messages.description ?? '')
    .map((part) => part.text)
    .join(''),
);
const metricLabel = computed(() => (event.value === null ? '' : eventText(event.value, t)));
const lateStart = computed(() => {
  const value = event.value;
  if (value?.baselineAt == null) return null;
  const delay = Date.parse(value.baselineAt) - Date.parse(value.startsAt);
  return delay > LATE_START_MS ? formatSpan(delay) : null;
});
const warnings = computed(() => {
  const value = detail.value;
  if (value === null) return [];
  const running = ['scheduled', 'active'].includes(value.event.state);
  const list: string[] = [];
  if (running && !value.capabilities.stats) list.push(t('competitions.warnings.stats'));
  if (running && !value.capabilities.events) list.push(t('competitions.warnings.events'));
  if (running && !value.capabilities.chat) list.push(t('competitions.warnings.chat'));
  else if (running && !value.capabilities.tasks) list.push(t('competitions.warnings.tasks'));
  if (lateStart.value !== null) {
    list.push(t('competitions.warnings.lateStart', { delay: lateStart.value }));
  }
  if (value.event.problem === 'missed') list.push(t('competitions.warnings.missed'));
  else if (value.event.problem !== null) {
    const key = `competitions.problems.${value.event.problem}`;
    list.push(te(key) ? t(key) : t('competitions.problems.error'));
  }
  return list;
});

const statusVariant = (status: RewardStatus['status']) =>
  status === 'done' ? 'secondary' : status === 'failed' ? 'destructive' : 'outline';

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void load();
  timer = setInterval(() => void load(), REFRESH_MS);
});
onUnmounted(() => clearInterval(timer));
defineExpose({ reload: load });
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" @click="emit('back')">
        <ArrowLeftIcon />
        {{ t('competitions.back') }}
      </Button>
      <div class="flex-1" />
      <Button
        v-if="countable"
        variant="outline"
        size="sm"
        :disabled="busy"
        @click="confirmingCount = true"
      >
        <RefreshCwIcon />
        {{ t('competitions.detail.countNow') }}
      </Button>
      <Button v-if="canManage && event" variant="outline" size="sm" @click="copyJson">
        <BracesIcon />
        {{ copiedJson ? t('competitions.detail.copiedJson') : t('competitions.actions.copyJson') }}
      </Button>
      <Button v-if="canManage && event" variant="outline" size="sm" @click="emit('clone')">
        <CopyIcon />
        {{ t('competitions.actions.clone') }}
      </Button>
      <Button v-if="editable" variant="outline" size="sm" @click="emit('edit')">
        <PencilIcon />
        {{ t('competitions.actions.edit') }}
      </Button>
    </div>

    <Alert v-if="error" variant="destructive" role="status">
      <CircleAlertIcon />
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div v-if="detail === null && error === null" class="flex justify-center py-8">
      <Spinner class="size-6" />
    </div>

    <template v-if="detail !== null && event !== null">
      <Card>
        <CardHeader>
          <CardTitle class="flex flex-wrap items-center gap-2">
            <span class="break-words">{{ event.name }}</span>
            <Badge :variant="event.state === 'active' ? 'default' : 'secondary'">
              {{ t(`competitions.states.${event.state}`) }}
            </Badge>
          </CardTitle>
          <CardDescription class="flex flex-col gap-0.5">
            <span>
              {{
                t('competitions.period', {
                  start: timeIn(event.startsAt),
                  end: timeIn(event.endsAt),
                })
              }}
              · {{ event.timezone }}
            </span>
            <span>{{ metricLabel }}</span>
          </CardDescription>
        </CardHeader>
        <CardContent class="text-muted-foreground flex flex-col gap-1 text-sm">
          <p v-if="description !== ''">{{ description }}</p>
          <p>
            <template v-if="event.scoring.kind === 'sum'">
              {{ t('competitions.detail.topOf', { top: event.participants.top }) }}
            </template>
            <template v-else>{{ t('competitions.detail.goalsInfo') }}</template
            ><template v-if="event.participants.excludeOperators">
              · {{ t('competitions.detail.operatorsOut') }}</template
            ><template v-if="event.participants.excluded.length > 0">
              ·
              {{
                t('competitions.detail.excludedCount', {
                  count: event.participants.excluded.length,
                })
              }}</template
            >
          </p>
        </CardContent>
      </Card>

      <Alert v-for="warning in warnings" :key="warning">
        <CircleAlertIcon />
        <AlertDescription>{{ warning }}</AlertDescription>
      </Alert>

      <Card v-if="event.scoring.kind === 'targets'">
        <CardHeader>
          <CardTitle>{{ t('competitions.detail.progress') }}</CardTitle>
          <CardDescription>
            {{ t('competitions.detail.reachedAll', { count: detail.completedCount }) }} ·
            {{
              detail.countedAt === null
                ? t('competitions.notCounted')
                : t('competitions.updated', { time: timeIn(detail.countedAt) })
            }}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p v-if="detail.progress.length === 0" class="text-muted-foreground text-sm">
            {{ t('competitions.detail.progressEmpty') }}
          </p>
          <div v-else class="overflow-x-auto">
            <Table data-testid="competition-progress">
              <TableHeader>
                <TableRow>
                  <TableHead>{{ t('competitions.detail.player') }}</TableHead>
                  <TableHead v-for="target in event.scoring.targets" :key="target.label">
                    {{ target.label }}
                  </TableHead>
                  <TableHead class="text-right">{{ t('competitions.detail.status') }}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="row in detail.progress" :key="row.uuid">
                  <TableCell>{{ row.name }}</TableCell>
                  <TableCell v-for="target in row.targets" :key="target.label" class="tabular-nums">
                    <span :class="target.value >= target.amount ? 'text-emerald-600' : ''">
                      {{ formatScore(Math.min(target.value, target.amount)) }}/{{
                        formatScore(target.amount)
                      }}
                    </span>
                  </TableCell>
                  <TableCell class="text-right">
                    <Badge v-if="row.done" variant="secondary">
                      {{ t('competitions.detail.doneAs', { place: row.place }) }}
                    </Badge>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card v-else>
        <CardHeader>
          <CardTitle>{{ t('competitions.detail.standings') }}</CardTitle>
          <CardDescription>
            {{
              detail.countedAt === null
                ? t('competitions.notCounted')
                : t('competitions.updated', { time: timeIn(detail.countedAt) })
            }}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p v-if="detail.standings.length === 0" class="text-muted-foreground text-sm">
            {{ t('competitions.detail.empty') }}
          </p>
          <Table v-else data-testid="competition-standings">
            <TableHeader>
              <TableRow>
                <TableHead class="w-16">{{ t('competitions.detail.place') }}</TableHead>
                <TableHead>{{ t('competitions.detail.player') }}</TableHead>
                <TableHead class="text-right">{{ t('competitions.detail.score') }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="standing in detail.standings" :key="standing.uuid">
                <TableCell>
                  {{ standing.place }}
                  <Badge
                    v-if="standing.place <= event.participants.top"
                    variant="secondary"
                    class="ml-1"
                    :title="t('competitions.detail.inTop')"
                    >★</Badge
                  >
                </TableCell>
                <TableCell>{{ standing.name }}</TableCell>
                <TableCell class="text-right tabular-nums">
                  {{ formatScore(standing.score) }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card v-if="event.state === 'finishing' || event.state === 'finished'">
        <CardHeader>
          <CardTitle>{{ t('competitions.detail.rewards') }}</CardTitle>
          <CardDescription>{{ t('competitions.detail.rewardsHint') }}</CardDescription>
        </CardHeader>
        <CardContent>
          <p v-if="detail.rewards.length === 0" class="text-muted-foreground text-sm">
            {{ t('competitions.detail.noRewards') }}
          </p>
          <div v-else class="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead class="w-16">{{ t('competitions.detail.place') }}</TableHead>
                  <TableHead>{{ t('competitions.detail.player') }}</TableHead>
                  <TableHead>{{ t('competitions.detail.command') }}</TableHead>
                  <TableHead>{{ t('competitions.detail.status') }}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="status in detail.rewards" :key="status.id" class="align-top">
                  <TableCell>{{ status.place }}</TableCell>
                  <TableCell>{{ status.playerName }}</TableCell>
                  <TableCell class="font-mono text-xs break-all">{{ status.command }}</TableCell>
                  <TableCell>
                    <Badge :variant="statusVariant(status.status)">
                      {{ t(`competitions.detail.rewardStatus.${status.status}`) }}
                    </Badge>
                    <div v-if="status.error" class="text-muted-foreground mt-1 max-w-xs text-xs">
                      {{ status.error }}
                    </div>
                  </TableCell>
                  <TableCell class="text-right whitespace-nowrap">
                    <Button
                      v-if="canRewards && status.status === 'failed'"
                      variant="outline"
                      size="sm"
                      :disabled="busy"
                      @click="reward(status, 'retry')"
                    >
                      {{ t('competitions.detail.retry') }}
                    </Button>
                    <Button
                      v-if="
                        canRewards && (status.status === 'failed' || status.status === 'pending')
                      "
                      variant="ghost"
                      size="sm"
                      :disabled="busy"
                      @click="reward(status, 'cancel')"
                    >
                      {{ t('competitions.detail.giveUp') }}
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </template>

    <AlertDialog
      :open="confirmingCount"
      @update:open="(value: boolean) => (confirmingCount = value)"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('competitions.detail.countNowTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>{{
            t('competitions.detail.countNowText')
          }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('competitions.form.cancel') }}</AlertDialogCancel>
          <AlertDialogAction :disabled="busy" @click="countNow">
            {{ t('competitions.detail.countNowConfirm') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
