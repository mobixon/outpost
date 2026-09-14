<script setup lang="ts">
import { CircleAlertIcon, DownloadIcon, InfoIcon, RefreshCwIcon } from '@lucide/vue';
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
  Input,
  Spinner,
} from '@outpost/ui';
import { ApiError, apiFetch, apiSend, useServerContext } from '@outpost/web-plugin-api';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import {
  assetsSchema,
  PLAYER_DETAILS_PLUGIN_ID,
  playerDetailSchema,
  playerListSchema,
  type Assets,
  type Item,
  type Place,
  type PlayerDetail,
  type PlayerSummary,
  type Stat,
  type StoredItem,
} from '../shared.js';
import ItemSlot from './ItemSlot.vue';

const POLL_MS = 3000;
const ADVANCEMENTS_SHOWN = 12;
const EULA_URL = 'https://www.minecraft.net/eula';

const { t, te, locale } = useI18n();
const { server } = useServerContext();
const route = useRoute();
const router = useRouter();
const can = (permission: string) => server.value.permissions.includes(permission);
const url = (path: string) => serverPluginApiPath(server.value.id, PLAYER_DETAILS_PLUGIN_ID, path);

const players = ref<PlayerSummary[] | null>(null);
const assets = ref<Assets | null>(null);
const search = ref('');
const detail = ref<PlayerDetail | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const selected = ref<StoredItem | Item | null>(null);
const allAdvancements = ref(false);
const starting = ref(false);

const selectedUuid = computed(() =>
  typeof route.query.player === 'string' ? route.query.player.toLowerCase() : null,
);
const nameLocale = computed(() => (locale.value.startsWith('ru') ? 'ru' : 'en'));

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const key = [`playerDetails.errors.${err.code}`, `errors.${err.code}`].find((name) => te(name));
    return key === undefined ? err.message : t(key);
  }
  return te('errors.network') ? t('errors.network') : String(err);
}

async function loadPlayers(): Promise<void> {
  try {
    const list = await apiFetch(url('/players'), playerListSchema);
    players.value = list.players;
    assets.value = list.assets;
    followDownload();
  } catch (err) {
    error.value = describeError(err);
  }
}

async function loadDetail(uuid: string | null): Promise<void> {
  selected.value = null;
  allAdvancements.value = false;
  if (uuid === null) {
    detail.value = null;
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    const path = `${url(`/players/${encodeURIComponent(uuid)}`)}?locale=${nameLocale.value}`;
    const result = await apiFetch(path, playerDetailSchema);
    if (selectedUuid.value !== uuid) return;
    detail.value = result;
    assets.value = result.assets;
  } catch (err) {
    detail.value = null;
    error.value = describeError(err);
  } finally {
    loading.value = false;
  }
}

function choose(uuid: string): void {
  void router.replace({ query: { ...route.query, player: uuid } });
}

watch([selectedUuid, nameLocale], ([uuid]) => void loadDetail(uuid), { immediate: true });

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase();
  return (players.value ?? []).filter(
    (player) =>
      query === '' ||
      (player.name ?? '').toLowerCase().includes(query) ||
      player.uuid.includes(query),
  );
});

let poll: ReturnType<typeof setInterval> | undefined;

/** Asks for the state of the download until it ends, then shows the icons. */
function followDownload(): void {
  clearInterval(poll);
  if (assets.value?.state !== 'downloading') return;
  poll = setInterval(() => void checkDownload(), POLL_MS);
}

async function checkDownload(): Promise<void> {
  try {
    assets.value = await apiFetch(url('/assets'), assetsSchema);
  } catch {
    return;
  }
  if (assets.value.state === 'downloading') return;
  clearInterval(poll);
  if (assets.value.state === 'ready') await loadDetail(selectedUuid.value);
}

async function download(): Promise<void> {
  starting.value = true;
  error.value = null;
  try {
    assets.value = await apiSend('POST', url('/assets'), { acceptEula: true }, assetsSchema);
    followDownload();
  } catch (err) {
    error.value = describeError(err);
  } finally {
    starting.value = false;
  }
}

onMounted(() => void loadPlayers());
onUnmounted(() => clearInterval(poll));

const assetsError = computed(() => {
  const code = assets.value?.error;
  if (!code) return null;
  const key = `playerDetails.assets.errors.${code}`;
  return te(key) ? t(key) : code;
});

/** The items of a container by slot, with empty slots. */
function slots(items: readonly StoredItem[], from: number, count: number): (StoredItem | null)[] {
  return Array.from(
    { length: count },
    (_, index) => items.find((item) => item.slot === from + index) ?? null,
  );
}

const inventory = computed(() => (detail.value ? slots(detail.value.inventory, 9, 27) : []));
const hotbar = computed(() => (detail.value ? slots(detail.value.inventory, 0, 9) : []));
const enderChest = computed(() => (detail.value ? slots(detail.value.enderChest, 0, 27) : []));
const worn = computed(() => {
  const armor = detail.value?.armor;
  if (!armor) return [];
  return (['head', 'chest', 'legs', 'feet'] as const).map((key) => ({ key, item: armor[key] }));
});
const contents = computed(() => {
  const item = selected.value;
  if (!item || !('contents' in item) || item.contents === null) return null;
  const size = item.id.endsWith('shulker_box') ? 27 : item.contents.length;
  return slots(item.contents, 0, size);
});

function select(item: StoredItem): void {
  selected.value = selected.value === item ? null : item;
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'short' });
const formatNumber = (value: number, digits = 0) =>
  value.toLocaleString(locale.value, { maximumFractionDigits: digits });

function formatStat(stat: Stat): string {
  if (stat.key === 'play_time') {
    const seconds = stat.value / 20;
    return t('playerDetails.units.duration', {
      h: Math.floor(seconds / 3600),
      m: Math.floor((seconds % 3600) / 60),
    });
  }
  if (stat.key.endsWith('_one_cm')) {
    const meters = stat.value / 100;
    return meters >= 1000
      ? t('playerDetails.units.km', { value: formatNumber(meters / 1000, 1) })
      : t('playerDetails.units.m', { value: formatNumber(meters) });
  }
  // Damage is counted in tenths of a health point; a heart is two points.
  if (stat.key.startsWith('damage_')) {
    return t('playerDetails.units.hearts', { value: formatNumber(stat.value / 20, 1) });
  }
  return formatNumber(stat.value);
}

/** Names of the main statistics, the same with and without the downloaded names. */
function statLabel(stat: Stat): string {
  const key = `playerDetails.stats.custom.${stat.key}`;
  return te(key) ? t(key) : stat.label;
}

const topLists = computed(() => {
  const stats = detail.value?.stats;
  if (!stats) return [];
  return (['mined', 'used', 'crafted', 'killed', 'killedBy'] as const)
    .map((key) => ({ key, entries: stats[key] }))
    .filter((group) => group.entries.length > 0);
});

const advancements = computed(() => {
  const list = detail.value?.advancements ?? [];
  return allAdvancements.value ? list : list.slice(0, ADVANCEMENTS_SHOWN);
});

function dimension(id: string): string {
  const key = `playerDetails.dimensions.${id.replace(/^minecraft:/, '')}`;
  return te(key) ? t(key) : id;
}
const formatPlace = (place: Place) =>
  `${Math.floor(place.x)}, ${Math.floor(place.y)}, ${Math.floor(place.z)} · ${dimension(place.dimension)}`;
</script>

<template>
  <div class="flex flex-col gap-6">
    <Alert v-if="error" variant="destructive" role="status">
      <CircleAlertIcon />
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <Alert v-if="assets && assets.state !== 'ready'" data-testid="player-details-assets">
      <Spinner v-if="assets.state === 'downloading'" />
      <InfoIcon v-else />
      <AlertDescription class="flex flex-col items-start gap-2">
        <template v-if="assets.version === null">{{
          t('playerDetails.assets.noVersion')
        }}</template>
        <template v-else-if="assets.state === 'downloading'">
          {{ t('playerDetails.assets.downloading', { version: assets.version }) }}
        </template>
        <template v-else>
          <span>{{ t('playerDetails.assets.missing', { version: assets.version }) }}</span>
          <span v-if="assetsError" class="text-destructive">
            {{ t('playerDetails.assets.failed', { error: assetsError }) }}
          </span>
          <template v-if="can(CorePermission.manage)">
            <span>
              {{ t('playerDetails.assets.eula') }}
              <a :href="EULA_URL" target="_blank" rel="noopener noreferrer" class="underline">{{
                t('playerDetails.assets.eulaLink')
              }}</a
              >.
            </span>
            <Button size="sm" variant="outline" :disabled="starting" @click="download">
              <DownloadIcon />
              {{ t('playerDetails.assets.download') }}
            </Button>
          </template>
          <span v-else>{{ t('playerDetails.assets.askOwner') }}</span>
        </template>
      </AlertDescription>
    </Alert>

    <div class="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <Card class="self-start">
        <CardHeader>
          <CardTitle class="flex items-center gap-2">
            {{ t('playerDetails.players') }}
            <div class="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              :aria-label="t('playerDetails.refresh')"
              :title="t('playerDetails.refresh')"
              @click="loadPlayers"
            >
              <RefreshCwIcon />
            </Button>
          </CardTitle>
          <CardDescription>{{ t('playerDetails.playersHint') }}</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-3">
          <Input
            v-model="search"
            :placeholder="t('playerDetails.search')"
            :aria-label="t('playerDetails.search')"
          />
          <div v-if="players === null" class="flex justify-center py-4"><Spinner /></div>
          <p v-else-if="filtered.length === 0" class="text-muted-foreground text-sm">
            {{ t('playerDetails.noPlayers') }}
          </p>
          <ul
            v-else
            class="-mx-2 flex max-h-[60vh] flex-col overflow-auto"
            data-testid="player-details-list"
          >
            <li v-for="player in filtered" :key="player.uuid">
              <button
                type="button"
                class="hover:bg-muted flex w-full flex-col rounded-md px-2 py-1.5 text-left"
                :class="{ 'bg-muted': player.uuid === selectedUuid }"
                :aria-current="player.uuid === selectedUuid ? 'true' : undefined"
                @click="choose(player.uuid)"
              >
                <span class="truncate font-mono text-sm font-medium">{{
                  player.name ?? player.uuid
                }}</span>
                <span class="text-muted-foreground text-xs">
                  {{ t('playerDetails.savedAt', { time: formatTime(player.savedAt) }) }}
                </span>
              </button>
            </li>
          </ul>
        </CardContent>
      </Card>

      <div class="flex min-w-0 flex-col gap-6">
        <p v-if="selectedUuid === null" class="text-muted-foreground py-8 text-center text-sm">
          {{ t('playerDetails.choose') }}
        </p>
        <div v-else-if="loading && !detail" class="flex justify-center py-8">
          <Spinner class="size-6" />
        </div>
        <template v-else-if="detail">
          <Card>
            <CardHeader>
              <CardTitle class="flex flex-wrap items-center gap-2">
                <span class="font-mono">{{ detail.name ?? detail.uuid }}</span>
                <Badge v-if="detail.gameMode" variant="secondary">
                  {{ t(`playerDetails.gameModes.${detail.gameMode}`) }}
                </Badge>
              </CardTitle>
              <CardDescription>
                {{ t('playerDetails.savedHint', { time: formatTime(detail.savedAt) }) }}
              </CardDescription>
            </CardHeader>
            <CardContent class="flex flex-col gap-6">
              <dl class="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <div v-if="detail.health !== null">
                  <dt class="text-muted-foreground">{{ t('playerDetails.health') }}</dt>
                  <dd>
                    {{
                      t('playerDetails.units.hearts', { value: formatNumber(detail.health / 2, 1) })
                    }}
                  </dd>
                </div>
                <div v-if="detail.food !== null">
                  <dt class="text-muted-foreground">{{ t('playerDetails.food') }}</dt>
                  <dd>{{ detail.food }} / 20</dd>
                </div>
                <div v-if="detail.xpLevel !== null">
                  <dt class="text-muted-foreground">{{ t('playerDetails.level') }}</dt>
                  <dd>
                    {{
                      t('playerDetails.levelValue', {
                        level: detail.xpLevel,
                        progress: Math.round((detail.xpProgress ?? 0) * 100),
                      })
                    }}
                  </dd>
                </div>
                <div class="col-span-2 sm:col-span-1">
                  <dt class="text-muted-foreground">UUID</dt>
                  <dd class="truncate font-mono text-xs" :title="detail.uuid">{{ detail.uuid }}</dd>
                </div>
              </dl>

              <div class="flex flex-wrap items-start gap-6">
                <section
                  class="flex max-w-full flex-col gap-2 overflow-x-auto"
                  data-testid="player-details-inventory"
                >
                  <h3 class="text-muted-foreground text-xs font-medium uppercase">
                    {{ t('playerDetails.inventory') }}
                  </h3>
                  <div class="grid w-max grid-cols-9 gap-0.5 sm:gap-1">
                    <ItemSlot
                      v-for="(item, index) in inventory"
                      :key="`inventory-${index}`"
                      :item="item"
                      :icons="detail.icons"
                      :textures="detail.textures"
                      :selected="item !== null && item === selected"
                      @select="select"
                    />
                  </div>
                  <div class="mt-1 grid w-max grid-cols-9 gap-0.5 sm:gap-1">
                    <ItemSlot
                      v-for="(item, index) in hotbar"
                      :key="`hotbar-${index}`"
                      :item="item"
                      :icons="detail.icons"
                      :textures="detail.textures"
                      :selected="item !== null && item === selected"
                      :highlight="index === detail.selectedSlot"
                      @select="select"
                    />
                  </div>
                </section>
                <section class="flex flex-col gap-2">
                  <h3 class="text-muted-foreground text-xs font-medium uppercase">
                    {{ t('playerDetails.armor') }}
                  </h3>
                  <div class="flex gap-1 sm:flex-col">
                    <ItemSlot
                      v-for="slot in worn"
                      :key="slot.key"
                      :item="slot.item"
                      :icons="detail.icons"
                      :textures="detail.textures"
                      :selected="slot.item !== null && slot.item === selected"
                      :aria-label="
                        slot.item ? undefined : t(`playerDetails.armorSlots.${slot.key}`)
                      "
                      @select="select"
                    />
                    <ItemSlot
                      class="sm:mt-2"
                      :item="detail.offhand"
                      :icons="detail.icons"
                      :textures="detail.textures"
                      :selected="detail.offhand !== null && detail.offhand === selected"
                      @select="select"
                    />
                  </div>
                </section>
              </div>

              <div
                v-if="selected"
                class="bg-muted/40 flex flex-col gap-2 rounded-md border p-3 text-sm"
                data-testid="player-details-item"
              >
                <div class="flex flex-wrap items-baseline gap-x-2">
                  <span v-if="selected.customName" class="font-medium italic">
                    {{ selected.customName }}
                  </span>
                  <span :class="selected.customName ? 'text-muted-foreground' : 'font-medium'">
                    {{ selected.label }}
                  </span>
                  <span v-if="selected.count > 1" class="text-muted-foreground">
                    × {{ selected.count }}
                  </span>
                  <span class="text-muted-foreground font-mono text-xs">{{ selected.id }}</span>
                </div>
                <ul
                  v-if="selected.enchantments.length > 0"
                  class="text-violet-600 dark:text-violet-400"
                >
                  <li v-for="enchantment in selected.enchantments" :key="enchantment.id">
                    {{ enchantment.label }}
                  </li>
                </ul>
                <p v-if="selected.maxDamage !== null && selected.damage !== null">
                  {{
                    t('playerDetails.item.durability', {
                      left: selected.maxDamage - selected.damage,
                      max: selected.maxDamage,
                    })
                  }}
                </p>
                <template v-if="contents">
                  <h4 class="text-muted-foreground text-xs font-medium uppercase">
                    {{ t('playerDetails.item.contents') }}
                  </h4>
                  <p v-if="contents.length === 0" class="text-muted-foreground">
                    {{ t('playerDetails.item.empty') }}
                  </p>
                  <div v-else class="grid w-max grid-cols-9 gap-0.5 sm:gap-1">
                    <ItemSlot
                      v-for="(item, index) in contents"
                      :key="`contents-${index}`"
                      :item="item"
                      :icons="detail.icons"
                      :textures="detail.textures"
                    />
                  </div>
                </template>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{{ t('playerDetails.enderChest') }}</CardTitle>
            </CardHeader>
            <CardContent class="flex flex-col gap-4">
              <div
                class="grid w-max max-w-full grid-cols-9 gap-0.5 overflow-x-auto sm:gap-1"
                data-testid="player-details-ender-chest"
              >
                <ItemSlot
                  v-for="(item, index) in enderChest"
                  :key="`ender-${index}`"
                  :item="item"
                  :icons="detail.icons"
                  :textures="detail.textures"
                  :selected="item !== null && item === selected"
                  @select="select"
                />
              </div>
              <p class="text-muted-foreground text-xs">{{ t('playerDetails.selectHint') }}</p>
            </CardContent>
          </Card>

          <Card v-if="detail.location" data-testid="player-details-location">
            <CardHeader>
              <CardTitle>{{ t('playerDetails.location.title') }}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
                <dt class="text-muted-foreground">{{ t('playerDetails.location.position') }}</dt>
                <dd class="font-mono">
                  {{
                    detail.location.position
                      ? formatPlace(detail.location.position)
                      : t('playerDetails.location.unknown')
                  }}
                </dd>
                <dt class="text-muted-foreground">{{ t('playerDetails.location.respawn') }}</dt>
                <dd class="font-mono">
                  {{
                    detail.location.respawn
                      ? formatPlace(detail.location.respawn)
                      : t('playerDetails.location.worldSpawn')
                  }}
                </dd>
                <dt class="text-muted-foreground">{{ t('playerDetails.location.lastDeath') }}</dt>
                <dd class="font-mono">
                  {{
                    detail.location.lastDeath
                      ? formatPlace(detail.location.lastDeath)
                      : t('playerDetails.location.unknown')
                  }}
                </dd>
              </dl>
            </CardContent>
          </Card>

          <Card v-if="detail.stats" data-testid="player-details-stats">
            <CardHeader>
              <CardTitle>{{ t('playerDetails.stats.title') }}</CardTitle>
            </CardHeader>
            <CardContent class="flex flex-col gap-6">
              <p v-if="detail.stats.custom.length === 0" class="text-muted-foreground text-sm">
                {{ t('playerDetails.stats.none') }}
              </p>
              <dl v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                <div
                  v-for="stat in detail.stats.custom"
                  :key="stat.key"
                  class="bg-muted/40 rounded-md border px-3 py-2"
                >
                  <dt class="text-muted-foreground truncate text-xs" :title="statLabel(stat)">
                    {{ statLabel(stat) }}
                  </dt>
                  <dd class="text-base font-semibold tabular-nums">{{ formatStat(stat) }}</dd>
                </div>
              </dl>
              <div v-if="topLists.length > 0" class="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                <section v-for="group in topLists" :key="group.key" class="flex flex-col gap-2">
                  <h3 class="text-muted-foreground text-xs font-medium uppercase">
                    {{ t(`playerDetails.stats.${group.key}`) }}
                  </h3>
                  <ol class="flex flex-col text-sm">
                    <li
                      v-for="entry in group.entries"
                      :key="entry.key"
                      class="flex justify-between gap-3 border-b py-1 last:border-b-0"
                    >
                      <span class="truncate" :title="entry.key">{{ entry.label }}</span>
                      <span class="text-muted-foreground tabular-nums">
                        {{ formatNumber(entry.value) }}
                      </span>
                    </li>
                  </ol>
                </section>
              </div>
            </CardContent>
          </Card>

          <Card v-if="detail.advancements" data-testid="player-details-advancements">
            <CardHeader>
              <CardTitle class="flex items-center gap-2">
                {{ t('playerDetails.advancements.title') }}
                <Badge variant="secondary">
                  {{ t('playerDetails.advancements.count', { count: detail.advancements.length }) }}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent class="flex flex-col gap-3">
              <p v-if="detail.advancements.length === 0" class="text-muted-foreground text-sm">
                {{ t('playerDetails.advancements.none') }}
              </p>
              <ul v-else class="grid gap-x-6 text-sm sm:grid-cols-2">
                <li
                  v-for="advancement in advancements"
                  :key="advancement.id"
                  class="flex justify-between gap-3 border-b py-1"
                >
                  <span class="truncate" :title="advancement.id">{{ advancement.title }}</span>
                  <span v-if="advancement.doneAt" class="text-muted-foreground text-xs">
                    {{ formatTime(advancement.doneAt) }}
                  </span>
                </li>
              </ul>
              <Button
                v-if="detail.advancements.length > ADVANCEMENTS_SHOWN"
                variant="outline"
                size="sm"
                class="self-start"
                @click="allAdvancements = !allAdvancements"
              >
                {{
                  allAdvancements
                    ? t('playerDetails.advancements.less')
                    : t('playerDetails.advancements.more')
                }}
              </Button>
            </CardContent>
          </Card>
        </template>
      </div>
    </div>
  </div>
</template>
