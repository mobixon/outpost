<script setup lang="ts">
import {
  CircleAlertIcon,
  EllipsisIcon,
  InfoIcon,
  RefreshCwIcon,
  Trash2Icon,
  UndoIcon,
  WrenchIcon,
} from '@lucide/vue';
import { CorePermission, serverPluginApiPath } from '@outpost/shared';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@outpost/ui';
import { ApiError, apiFetch, apiSend, useServerContext } from '@outpost/web-plugin-api';
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRouter } from 'vue-router';
import {
  actionResultSchema,
  overviewSchema,
  playerDetailSchema,
  playerPageSchema,
  PLAYERS_PLUGIN_ID,
  PlayersPermission,
  type Overview,
  type Player,
  type PlayerDetail,
} from '../shared.js';

const REFRESH_MS = 15_000;
const PAGE_SIZE = 50;

const { t, te, locale } = useI18n();
const { server } = useServerContext();
const can = (permission: string) => server.value.permissions.includes(permission);
const url = (path: string) => serverPluginApiPath(server.value.id, PLAYERS_PLUGIN_ID, path);
const router = useRouter();

// The tab of the Player details module, when it is enabled and the user may see it.
const DETAILS_ROUTE = 'server-outpost.player-details-player-details';
const detailsLink = computed(() => {
  const uuid = detail.value?.player.uuid;
  if (
    uuid === undefined ||
    !router.hasRoute(DETAILS_ROUTE) ||
    !can('player-details.view') ||
    !server.value.capabilities.includes('files.read')
  ) {
    return null;
  }
  return { name: DETAILS_ROUTE, params: { slug: server.value.slug }, query: { player: uuid } };
});

const overview = ref<Overview | null>(null);
const players = ref<Player[]>([]);
const total = ref(0);
const search = ref('');
const detail = ref<PlayerDetail | null>(null);
const form = reactive({ name: '', reason: '', ip: '', ipReason: '', whitelistName: '' });
const message = ref<{ kind: 'info' | 'warning' | 'error'; text: string } | null>(null);
const busy = ref(false);
const loading = ref(false);

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const key = [`players.errors.${err.code}`, `errors.${err.code}`].find((name) => te(name));
    return key === undefined ? err.message : t(key);
  }
  return te('errors.network') ? t('errors.network') : String(err);
}

async function loadOverview(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  try {
    overview.value = await apiFetch(url('/overview'), overviewSchema);
  } catch (err) {
    message.value = { kind: 'error', text: describeError(err) };
  } finally {
    loading.value = false;
  }
}

async function loadPlayers(more = false): Promise<void> {
  const query = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(more ? players.value.length : 0),
  });
  if (search.value.trim() !== '') query.set('search', search.value.trim());
  const page = await apiFetch(`${url('/players')}?${query}`, playerPageSchema);
  players.value = more ? [...players.value, ...page.players] : page.players;
  total.value = page.total;
}

async function refresh(): Promise<void> {
  await Promise.all([loadOverview(), loadPlayers().catch(() => undefined)]);
}

/** Runs a player action and shows the server's reply, a pending note or a warning. */
async function run(path: string, body: object): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  message.value = null;
  try {
    const result = await apiSend('POST', url(path), body, actionResultSchema);
    if (result.pending) message.value = { kind: 'info', text: t('players.pendingCreated') };
    else if (result.warning !== null) {
      const note =
        result.warning === 'applies_on_restart'
          ? t('players.warningRestart')
          : t('players.warningOffline');
      message.value = { kind: 'warning', text: `${result.reply} ${note}`.trim() };
    } else message.value = { kind: 'info', text: result.reply || t('players.noReply') };
    await refresh();
  } catch (err) {
    message.value = { kind: 'error', text: describeError(err) };
  } finally {
    busy.value = false;
  }
}

const withName = (path: string, name = form.name.trim(), reason?: string) =>
  run(path, { name, ...(reason ? { reason } : {}) });

async function pending(id: string, apply: boolean): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  message.value = null;
  try {
    if (apply) {
      const result = await apiSend('POST', url(`/pending/${id}/apply`), {}, actionResultSchema);
      message.value = { kind: 'info', text: result.reply || t('players.noReply') };
    } else {
      await apiSend('DELETE', url(`/pending/${id}`));
    }
    await refresh();
  } catch (err) {
    message.value = { kind: 'error', text: describeError(err) };
  } finally {
    busy.value = false;
  }
}

async function setMode(value: unknown): Promise<void> {
  if (typeof value !== 'string') return;
  try {
    await apiSend('PUT', url('/mode'), { mode: value });
    await loadOverview();
  } catch (err) {
    message.value = { kind: 'error', text: describeError(err) };
  }
}

async function openPlayer(uuid: string): Promise<void> {
  try {
    detail.value = await apiFetch(url(`/players/${encodeURIComponent(uuid)}`), playerDetailSchema);
  } catch (err) {
    message.value = { kind: 'error', text: describeError(err) };
  }
}

const modeLabel = computed(() => {
  const mode = overview.value?.mode;
  if (!mode?.effective) return t('players.mode.unknown');
  const source = mode.override ? 'manual' : mode.detected ? 'detected' : 'configured';
  return `${t(`players.mode.${mode.effective}`)} · ${t(`players.mode.${source}`)}`;
});
const modeValue = computed(() => overview.value?.mode.override ?? 'auto');
/** server.properties and the players online disagree, e.g. behind a proxy. */
const modeMismatch = computed(() => {
  const mode = overview.value?.mode;
  return (
    !!mode &&
    mode.override === null &&
    mode.detected !== null &&
    mode.configured !== null &&
    mode.detected !== mode.configured
  );
});

/** How the whitelist is changed: in whitelist.json, over RCON, or not at all. */
const whitelistChange = computed(
  () => overview.value?.whitelist?.change ?? (overview.value?.rcon ? 'rcon' : null),
);
const whitelistHint = computed(() => {
  const list = overview.value?.whitelist;
  if (list?.change === 'file') {
    return list.reloads ? t('players.whitelist.file') : t('players.whitelist.fileNoRcon');
  }
  if (list?.source === 'file') {
    return list.change === 'rcon'
      ? t('players.whitelist.readOnlyFiles')
      : t('players.whitelist.readOnly');
  }
  return t('players.whitelist.hint');
});
const whitelistErrorText = computed(() => {
  const code = overview.value?.whitelistError;
  if (!code) return null;
  const key = `players.errors.${code}`;
  return te(key) ? t(key) : t('players.whitelist.unreadable');
});
const wrongCount = computed(
  () => overview.value?.whitelist?.entries.filter((entry) => entry.wrongUuid).length ?? 0,
);
const doctorText = computed(() => {
  let key = 'readOnly';
  if (overview.value?.whitelist?.fixable) key = 'fixable';
  else if (overview.value?.mode.effective === 'online') key = 'online';
  return t(`players.whitelist.doctor.${key}`, { count: wrongCount.value });
});

const formatTime = (iso: string | null) =>
  iso === null
    ? ''
    : new Date(iso).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'short' });
const formatDuration = (ms: number) =>
  t('players.history.duration', {
    h: Math.floor(ms / 3_600_000),
    m: Math.floor((ms % 3_600_000) / 60_000),
  });

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void refresh();
  timer = setInterval(() => void loadOverview(), REFRESH_MS);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-center gap-2">
      <Badge variant="outline" :title="t('players.mode.hint')">{{ modeLabel }}</Badge>
      <Select
        v-if="can(CorePermission.manage)"
        :model-value="modeValue"
        @update:model-value="setMode"
      >
        <SelectTrigger size="sm" class="w-52" :aria-label="t('players.mode.label')">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">{{ t('players.mode.auto') }}</SelectItem>
          <SelectItem value="online">{{ t('players.mode.online') }}</SelectItem>
          <SelectItem value="offline">{{ t('players.mode.offline') }}</SelectItem>
        </SelectContent>
      </Select>
      <span v-if="modeMismatch" class="text-muted-foreground text-xs">
        {{ t('players.mode.mismatch') }}
      </span>
      <div class="flex-1" />
      <Button variant="ghost" size="sm" :disabled="loading" @click="refresh">
        <RefreshCwIcon :class="{ 'animate-spin': loading }" />
        {{ t('players.refresh') }}
      </Button>
    </div>

    <Alert
      v-if="message"
      :variant="message.kind === 'error' ? 'destructive' : 'default'"
      role="status"
    >
      <CircleAlertIcon v-if="message.kind !== 'info'" />
      <InfoIcon v-else />
      <AlertDescription data-testid="players-message">{{ message.text }}</AlertDescription>
    </Alert>
    <Alert v-if="overview && !overview.reachable" variant="destructive">
      <CircleAlertIcon />
      <AlertDescription>{{ t('players.unreachable') }}</AlertDescription>
    </Alert>
    <Alert v-if="overview && !overview.rcon">
      <InfoIcon />
      <AlertDescription>{{ t('players.noRcon') }}</AlertDescription>
    </Alert>

    <div v-if="overview === null" class="flex justify-center py-8"><Spinner class="size-6" /></div>

    <template v-else>
      <Card v-if="overview.rcon">
        <CardHeader>
          <CardTitle class="flex items-center gap-2">
            {{ t('players.online') }}
            <Badge v-if="overview.max !== null" variant="secondary">
              {{ t('players.onlineCount', { online: overview.online.length, max: overview.max }) }}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p v-if="overview.online.length === 0" class="text-muted-foreground text-sm">
            {{ t('players.nobody') }}
          </p>
          <ul v-else class="divide-y" data-testid="players-online">
            <li
              v-for="player in overview.online"
              :key="player.uuid"
              class="flex items-center gap-3 py-2"
            >
              <span
                class="bg-primary/15 text-primary flex size-8 shrink-0 items-center justify-center rounded-md font-mono text-sm font-semibold"
                aria-hidden="true"
                >{{ player.name.charAt(0).toUpperCase() }}</span
              >
              <button
                type="button"
                class="flex min-w-0 flex-1 flex-col text-left"
                @click="openPlayer(player.uuid)"
              >
                <span class="truncate font-mono text-sm font-medium">{{ player.name }}</span>
                <span v-if="player.since" class="text-muted-foreground text-xs">
                  {{ t('players.since', { time: formatTime(player.since) }) }}
                </span>
              </button>
              <DropdownMenu
                v-if="
                  can(PlayersPermission.kick) ||
                  can(PlayersPermission.ban) ||
                  can(PlayersPermission.op)
                "
              >
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon"
                    :disabled="busy"
                    :aria-label="t('players.actions.menu', { name: player.name })"
                  >
                    <EllipsisIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="w-56">
                  <DropdownMenuItem
                    v-if="can(PlayersPermission.kick)"
                    @select="withName('/kick', player.name)"
                  >
                    {{ t('players.actions.kick') }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    v-if="can(PlayersPermission.op)"
                    @select="withName('/op', player.name)"
                  >
                    {{ t('players.actions.op') }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    v-if="can(PlayersPermission.op)"
                    @select="withName('/deop', player.name)"
                  >
                    {{ t('players.actions.deop') }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    v-if="can(PlayersPermission.ban)"
                    variant="destructive"
                    @select="withName('/ban', player.name)"
                  >
                    {{ t('players.actions.ban') }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card
        v-if="
          (overview.rcon &&
            (can(PlayersPermission.kick) ||
              can(PlayersPermission.ban) ||
              can(PlayersPermission.op))) ||
          (can(PlayersPermission.whitelist) && whitelistChange !== null)
        "
      >
        <CardHeader>
          <CardTitle>{{ t('players.actions.title') }}</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-4">
          <FieldGroup class="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel for="player-name">{{ t('players.actions.name') }}</FieldLabel>
              <Input
                id="player-name"
                v-model="form.name"
                class="font-mono"
                maxlength="16"
                autocomplete="off"
                spellcheck="false"
              />
            </Field>
            <Field>
              <FieldLabel for="player-reason">{{ t('players.actions.reason') }}</FieldLabel>
              <Input id="player-reason" v-model="form.reason" maxlength="200" />
            </Field>
          </FieldGroup>
          <div class="flex flex-wrap gap-2">
            <Button
              v-if="overview.rcon && can(PlayersPermission.kick)"
              variant="outline"
              :disabled="busy || !form.name.trim()"
              @click="withName('/kick', undefined, form.reason)"
            >
              {{ t('players.actions.kick') }}
            </Button>
            <Button
              v-if="overview.rcon && can(PlayersPermission.ban)"
              variant="outline"
              :disabled="busy || !form.name.trim()"
              @click="withName('/ban', undefined, form.reason)"
            >
              {{ t('players.actions.ban') }}
            </Button>
            <Button
              v-if="overview.rcon && can(PlayersPermission.ban)"
              variant="outline"
              :disabled="busy || !form.name.trim()"
              @click="withName('/pardon')"
            >
              {{ t('players.actions.pardon') }}
            </Button>
            <Button
              v-if="can(PlayersPermission.whitelist) && whitelistChange !== null"
              variant="outline"
              :disabled="busy || !form.name.trim()"
              @click="withName('/whitelist/add')"
            >
              {{ t('players.actions.whitelistAdd') }}
            </Button>
            <Button
              v-if="can(PlayersPermission.whitelist) && whitelistChange !== null"
              variant="outline"
              :disabled="busy || !form.name.trim()"
              @click="withName('/whitelist/remove')"
            >
              {{ t('players.actions.whitelistRemove') }}
            </Button>
            <Button
              v-if="overview.rcon && can(PlayersPermission.op)"
              variant="outline"
              :disabled="busy || !form.name.trim()"
              @click="withName('/op')"
            >
              {{ t('players.actions.op') }}
            </Button>
            <Button
              v-if="overview.rcon && can(PlayersPermission.op)"
              variant="outline"
              :disabled="busy || !form.name.trim()"
              @click="withName('/deop')"
            >
              {{ t('players.actions.deop') }}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card v-if="overview.pending.length > 0">
        <CardHeader>
          <CardTitle>{{ t('players.pending.title') }}</CardTitle>
          <CardDescription>{{ t('players.pending.text') }}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul class="divide-y" data-testid="players-pending">
            <li
              v-for="entry in overview.pending"
              :key="entry.id"
              class="flex flex-wrap items-center gap-2 py-2"
            >
              <span class="font-mono text-sm font-medium">{{ entry.name }}</span>
              <Badge variant="secondary">{{ t(`players.pending.${entry.action}`) }}</Badge>
              <span class="text-muted-foreground text-xs">{{ entry.reason ?? '' }}</span>
              <div class="flex-1" />
              <Button size="sm" variant="outline" :disabled="busy" @click="pending(entry.id, true)">
                {{ t('players.pending.apply') }}
              </Button>
              <Button size="sm" variant="ghost" :disabled="busy" @click="pending(entry.id, false)">
                {{ t('players.pending.cancel') }}
              </Button>
            </li>
          </ul>
        </CardContent>
      </Card>

      <div class="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle class="flex items-center gap-2">
              {{ t('players.whitelist.title') }}
              <Badge
                v-if="overview.whitelist && overview.whitelist.enabled !== null"
                :variant="overview.whitelist.enabled ? 'default' : 'secondary'"
                data-testid="players-whitelist-state"
              >
                {{
                  overview.whitelist.enabled
                    ? t('players.whitelist.isOn')
                    : t('players.whitelist.isOff')
                }}
              </Badge>
            </CardTitle>
            <CardDescription>{{ whitelistHint }}</CardDescription>
          </CardHeader>
          <CardContent class="flex flex-col gap-4">
            <p v-if="whitelistErrorText" class="text-destructive text-sm">
              {{ whitelistErrorText }}
            </p>
            <Alert
              v-if="wrongCount > 0"
              variant="destructive"
              data-testid="players-whitelist-doctor"
            >
              <CircleAlertIcon />
              <AlertDescription class="flex flex-col items-start gap-2">
                {{ doctorText }}
                <Button
                  v-if="overview.whitelist?.fixable && can(PlayersPermission.whitelist)"
                  size="sm"
                  variant="outline"
                  :disabled="busy"
                  @click="run('/whitelist/fix', {})"
                >
                  <WrenchIcon />
                  {{ t('players.whitelist.doctor.fix') }}
                </Button>
              </AlertDescription>
            </Alert>
            <p
              v-if="overview.whitelist?.entries.length === 0"
              class="text-muted-foreground text-sm"
            >
              {{ t('players.whitelist.empty') }}
            </p>
            <ul
              v-else-if="overview.whitelist"
              class="flex flex-wrap gap-2"
              data-testid="players-whitelist"
            >
              <li v-for="entry in overview.whitelist.entries" :key="entry.uuid ?? entry.name">
                <Badge
                  :variant="entry.wrongUuid ? 'destructive' : 'secondary'"
                  class="gap-1 font-mono"
                  :title="
                    entry.wrongUuid
                      ? t('players.whitelist.wrongUuid', { uuid: entry.uuid })
                      : (entry.uuid ?? undefined)
                  "
                >
                  {{ entry.name }}
                  <button
                    v-if="can(PlayersPermission.whitelist) && whitelistChange !== null"
                    type="button"
                    class="hover:text-destructive"
                    :aria-label="t('players.whitelist.remove', { name: entry.name })"
                    :disabled="busy"
                    @click="withName('/whitelist/remove', entry.name)"
                  >
                    <Trash2Icon class="size-3" />
                  </button>
                </Badge>
              </li>
            </ul>
            <div
              v-if="can(PlayersPermission.whitelist) && overview.rcon"
              class="flex flex-wrap gap-2"
            >
              <Button
                v-if="overview.whitelist?.enabled !== true"
                size="sm"
                variant="outline"
                :disabled="busy"
                @click="run('/whitelist/state', { enabled: true })"
              >
                {{ t('players.whitelist.on') }}
              </Button>
              <Button
                v-if="overview.whitelist?.enabled !== false"
                size="sm"
                variant="outline"
                :disabled="busy"
                @click="run('/whitelist/state', { enabled: false })"
              >
                {{ t('players.whitelist.off') }}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card v-if="overview.rcon">
          <CardHeader>
            <CardTitle>{{ t('players.bans.title') }}</CardTitle>
          </CardHeader>
          <CardContent class="flex flex-col gap-4 text-sm">
            <div>
              <h3 class="text-muted-foreground mb-2 text-xs font-medium uppercase">
                {{ t('players.bans.players') }}
              </h3>
              <p v-if="overview.bans?.length === 0" class="text-muted-foreground">
                {{ t('players.bans.empty') }}
              </p>
              <ul v-else-if="overview.bans" class="divide-y" data-testid="players-bans">
                <li
                  v-for="ban in overview.bans"
                  :key="ban.target"
                  class="flex items-center gap-2 py-1.5"
                >
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="font-mono font-medium">{{ ban.target }}</span>
                    <span class="text-muted-foreground truncate text-xs">
                      {{ ban.reason }} · {{ t('players.bans.by', { source: ban.source }) }}
                    </span>
                  </div>
                  <Button
                    v-if="can(PlayersPermission.ban)"
                    variant="ghost"
                    size="icon"
                    :disabled="busy"
                    :aria-label="t('players.bans.pardon', { target: ban.target })"
                    :title="t('players.bans.pardon', { target: ban.target })"
                    @click="withName('/pardon', ban.target)"
                  >
                    <UndoIcon />
                  </Button>
                </li>
              </ul>
            </div>
            <div>
              <h3 class="text-muted-foreground mb-2 text-xs font-medium uppercase">
                {{ t('players.bans.ips') }}
              </h3>
              <p v-if="overview.ipBans?.length === 0" class="text-muted-foreground">
                {{ t('players.bans.empty') }}
              </p>
              <ul v-else-if="overview.ipBans" class="divide-y">
                <li
                  v-for="ban in overview.ipBans"
                  :key="ban.target"
                  class="flex items-center gap-2 py-1.5"
                >
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="font-mono font-medium">{{ ban.target }}</span>
                    <span class="text-muted-foreground truncate text-xs">{{ ban.reason }}</span>
                  </div>
                  <Button
                    v-if="can(PlayersPermission.ban)"
                    variant="ghost"
                    size="icon"
                    :disabled="busy"
                    :aria-label="t('players.bans.pardon', { target: ban.target })"
                    @click="run('/pardon-ip', { ip: ban.target })"
                  >
                    <UndoIcon />
                  </Button>
                </li>
              </ul>
              <form
                v-if="can(PlayersPermission.ban)"
                class="mt-3 flex flex-wrap gap-2"
                @submit.prevent="
                  run('/ban-ip', {
                    ip: form.ip.trim(),
                    ...(form.ipReason ? { reason: form.ipReason } : {}),
                  })
                "
              >
                <Input
                  v-model="form.ip"
                  class="w-40 font-mono"
                  :placeholder="t('players.bans.ip')"
                  :aria-label="t('players.bans.ip')"
                />
                <Input
                  v-model="form.ipReason"
                  class="w-40 flex-1"
                  :placeholder="t('players.actions.reason')"
                  :aria-label="t('players.bans.ipReason')"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  :disabled="busy || !form.ip.trim()"
                >
                  {{ t('players.bans.banIp') }}
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{{ t('players.history.title') }}</CardTitle>
          <CardDescription>{{ t('players.history.note') }}</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-4">
          <Input
            v-model="search"
            class="max-w-xs"
            :placeholder="t('players.history.search')"
            :aria-label="t('players.history.search')"
            @input="loadPlayers()"
          />
          <p v-if="players.length === 0" class="text-muted-foreground text-sm">
            {{ t('players.history.empty') }}
          </p>
          <Table v-else>
            <TableHeader>
              <TableRow>
                <TableHead>{{ t('players.history.name') }}</TableHead>
                <TableHead>{{ t('players.history.lastSeen') }}</TableHead>
                <TableHead>{{ t('players.history.playtime') }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="player in players"
                :key="player.uuid"
                class="cursor-pointer"
                @click="openPlayer(player.uuid)"
              >
                <TableCell class="font-mono">
                  {{ player.name }}
                  <Badge v-if="player.online" class="ml-2">{{
                    t('players.history.onlineBadge')
                  }}</Badge>
                </TableCell>
                <TableCell class="text-muted-foreground">{{
                  formatTime(player.lastSeen)
                }}</TableCell>
                <TableCell>{{ formatDuration(player.playtimeMs) }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <Button
            v-if="players.length < total"
            variant="outline"
            class="self-center"
            @click="loadPlayers(true)"
          >
            {{ t('players.history.more') }}
          </Button>
        </CardContent>
      </Card>
    </template>

    <Dialog
      :open="detail !== null"
      @update:open="
        (value: boolean) => {
          if (!value) detail = null;
        }
      "
    >
      <DialogContent v-if="detail" class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle class="font-mono">{{ detail.player.name }}</DialogTitle>
        </DialogHeader>
        <dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
          <dt class="text-muted-foreground">UUID</dt>
          <dd class="font-mono text-xs break-all">{{ detail.player.uuid }}</dd>
          <dt class="text-muted-foreground">{{ t('players.history.firstSeen') }}</dt>
          <dd>{{ formatTime(detail.player.firstSeen) }}</dd>
          <dt class="text-muted-foreground">{{ t('players.history.lastSeen') }}</dt>
          <dd>{{ formatTime(detail.player.lastSeen) }}</dd>
          <dt class="text-muted-foreground">{{ t('players.history.playtime') }}</dt>
          <dd>{{ formatDuration(detail.player.playtimeMs) }}</dd>
        </dl>
        <Button v-if="detailsLink" as-child variant="outline" size="sm" class="justify-self-start">
          <RouterLink :to="detailsLink">{{ t('players.history.details') }}</RouterLink>
        </Button>
        <h3 class="mt-2 font-medium">{{ t('players.history.sessions') }}</h3>
        <div class="max-h-64 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{{ t('players.history.joined') }}</TableHead>
                <TableHead>{{ t('players.history.left') }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="session in detail.sessions" :key="session.joinedAt">
                <TableCell>{{ formatTime(session.joinedAt) }}</TableCell>
                <TableCell>{{
                  session.leftAt === null
                    ? t('players.history.stillOnline')
                    : formatTime(session.leftAt)
                }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
