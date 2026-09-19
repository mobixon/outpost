<script setup lang="ts">
import { CircleAlertIcon } from '@lucide/vue';
import {
  parseMessage,
  renderTemplate,
  serverPluginApiPath,
  templatePlaceholders,
} from '@outpost/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  MessagePreview,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from '@outpost/ui';
import { apiFetch, apiSend, useServerContext } from '@outpost/web-plugin-api';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  formatScore,
  renderAnnouncement,
  renderJoin,
  renderResults,
  renderReward,
  renderTop,
  type RenderableEvent,
} from '../render.js';
import {
  BLOCK_PRESET_IDS,
  candidateListSchema,
  COMPETITIONS_PLUGIN_ID,
  eventSchema,
  announcementKey,
  isValidTimezone,
  rewardTestResultSchema,
  type Announcement,
  type RewardTestResult,
  MAX_ANNOUNCEMENT_MINUTES,
  MAX_ANNOUNCEMENTS,
  MAX_DESCRIPTION_LENGTH,
  METRIC_KINDS,
  MAX_TOP,
  PLACEHOLDERS,
  REWARD_COMMAND_PERMISSION,
  type BlockPreset,
  type CandidateList,
  type CompetitionEvent,
  type Messages,
  type Standing,
  type TemplateKind,
} from '../shared.js';
import {
  applyPeriod,
  cloneForm,
  COUNT_EVERY_CHOICES,
  changeTimezone,
  emptyForm,
  fromEvent,
  parseBlocks,
  parseCommands,
  PERIODS,
  problemsOf,
  toInput,
} from './form.js';
import PlayerPicker from './PlayerPicker.vue';
import { describe } from './util.js';

const props = defineProps<{
  event: CompetitionEvent | null;
  /** Start a new event from `event` instead of changing it. */
  clone?: boolean;
}>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ saved: [] }>();

const { t, te } = useI18n();
const describeError = (err: unknown) => describe(err, t, te);
const { server } = useServerContext();
const url = (path: string) => serverPluginApiPath(server.value.id, COMPETITIONS_PLUGIN_ID, path);

const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const timezones = Intl.supportedValuesOf('timeZone');

const form = ref(emptyForm(browserZone));
const zoneDraft = ref(browserZone);
const candidates = ref<CandidateList['players']>([]);
const state = reactive<{ busy: boolean; error: string | null }>({ busy: false, error: null });

const canRewards = computed(() => server.value.permissions.includes(REWARD_COMMAND_PERMISSION));
/** What is counted and the start are fixed once the event runs. */
const editing = computed(() => props.event !== null && props.clone !== true);
const running = computed(() => editing.value && props.event?.state === 'active');
const problems = computed(() => problemsOf(form.value));
const zoneValid = computed(() => isValidTimezone(zoneDraft.value.trim()));
const valid = computed(() => problems.value.length === 0 && zoneValid.value);

watch(open, async (isOpen) => {
  if (!isOpen) return;
  form.value =
    props.event === null
      ? emptyForm(browserZone)
      : props.clone === true
        ? cloneForm(props.event)
        : fromEvent(props.event);
  zoneDraft.value = form.value.timezone;
  state.error = null;
  testPlayer.value = '';
  tests.value = {};
  try {
    candidates.value = (await apiFetch(url('/players'), candidateListSchema)).players;
  } catch {
    candidates.value = [];
  }
});

function setZone(): void {
  const zone = zoneDraft.value.trim();
  if (isValidTimezone(zone)) changeTimezone(form.value, zone);
}

function togglePreset(preset: BlockPreset): void {
  const { presets } = form.value;
  form.value.presets = presets.includes(preset)
    ? presets.filter((entry) => entry !== preset)
    : [...presets, preset];
}

function setMetric(value: unknown): void {
  if (value === 'mined' || value === 'fish_caught') form.value.metric = value;
}

function setTop(value: unknown): void {
  const top = Number(value);
  if (Number.isInteger(top) && top >= 1 && top <= MAX_TOP) form.value.top = top;
}

async function save(): Promise<void> {
  if (state.busy || !valid.value) return;
  const body = toInput(form.value);
  if (body === null) return;
  state.busy = true;
  state.error = null;
  try {
    if (props.event === null || props.clone === true) {
      await apiSend('POST', url('/events'), body, eventSchema);
    } else await apiSend('PUT', url(`/events/${props.event.id}`), body, eventSchema);
    open.value = false;
    emit('saved');
  } catch (err) {
    state.error = describeError(err);
  } finally {
    state.busy = false;
  }
}

// --- Texts and their previews ------------------------------------------------------------------

const TEMPLATES = [
  'top',
  'entry',
  'join',
  'results',
  'reward',
] as const satisfies readonly (keyof Messages & TemplateKind)[];
const templateRows: Record<(typeof TEMPLATES)[number], number> = {
  top: 5,
  entry: 1,
  join: 4,
  results: 4,
  reward: 2,
};

const placeholderList = (kind: TemplateKind) =>
  PLACEHOLDERS[kind].map((name) => `{${name}}`).join(', ');
const unknownPlaceholders = (kind: TemplateKind, text: string) =>
  templatePlaceholders(text).filter(
    (name) => !(PLACEHOLDERS[kind] as readonly string[]).includes(name),
  );

const SAMPLE_STANDINGS: Standing[] = [
  { place: 1, uuid: '1', name: 'Steve', score: 1240 },
  { place: 2, uuid: '2', name: 'Alex', score: 980 },
  { place: 3, uuid: '3', name: 'Notch', score: 655 },
];

const sample = computed((): RenderableEvent => {
  const value = form.value;
  return {
    name: value.name.trim() || t('competitions.form.name'),
    startsAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    endsAt: new Date(Date.now() + (3 * 24 + 5) * 3_600_000).toISOString(),
    timezone: isValidTimezone(value.timezone) ? value.timezone : 'UTC',
    metric:
      value.metric === 'mined'
        ? { kind: 'mined', presets: value.presets, blocks: parseBlocks(value.blocks) }
        : { kind: 'fish_caught' },
    messages: value.messages,
    participants: { top: value.top, excludeOperators: value.excludeOperators, excluded: [] },
  };
});

const previews = computed(() => {
  const now = Date.now();
  const event = sample.value;
  const viewer = { name: 'Alex' };
  return {
    top: renderTop(event, SAMPLE_STANDINGS, now, viewer),
    join: renderJoin(event, SAMPLE_STANDINGS, now, viewer),
    results: renderResults(event, SAMPLE_STANDINGS, now),
    reward: renderReward(event, { name: 'Steve', place: 1, score: 1240 }),
  };
});
const previewOf = (key: (typeof TEMPLATES)[number]) =>
  key === 'entry'
    ? SAMPLE_STANDINGS.slice(0, 1).map((standing) =>
        parseMessage(
          renderTemplate(form.value.messages.entry, {
            place: String(standing.place),
            name: standing.name,
            score: formatScore(standing.score),
          }),
        ),
      )
    : previews.value[key].map(parseMessage);

// --- Announcements ---------------------------------------------------------------------------

function addAnnouncement(): void {
  const taken = new Set(form.value.announcements.map(announcementKey));
  let minutes = 5;
  while (taken.has(announcementKey({ anchor: 'start', minutesBefore: minutes }))) minutes++;
  if (form.value.announcements.length >= MAX_ANNOUNCEMENTS) return;
  form.value.announcements.push({
    anchor: 'start',
    minutesBefore: minutes,
    text: '&6&l{event}&r &7starts in &f{starts_in}&7!',
  });
}

function removeAnnouncement(index: number): void {
  form.value.announcements.splice(index, 1);
}

function setAnchor(announcement: Announcement, value: unknown): void {
  if (value === 'start' || value === 'end') announcement.anchor = value;
}

function setMinutes(announcement: Announcement, value: string | number): void {
  const minutes = Math.round(Number(value));
  announcement.minutesBefore = Number.isFinite(minutes)
    ? Math.min(Math.max(minutes, 0), MAX_ANNOUNCEMENT_MINUTES)
    : 0;
}

const duplicateMoment = (index: number) => {
  const key = announcementKey(
    form.value.announcements[index] ?? { anchor: 'start', minutesBefore: 0 },
  );
  return form.value.announcements.findIndex((entry) => announcementKey(entry) === key) !== index;
};

const announcementPreview = (announcement: Announcement) =>
  renderAnnouncement(sample.value, announcement.text, SAMPLE_STANDINGS, Date.now()).map(
    parseMessage,
  );

function setCountEvery(value: unknown): void {
  const minutes = Number(value);
  if (COUNT_EVERY_CHOICES.some((choice) => choice === minutes))
    form.value.countEveryMinutes = minutes;
}

// --- Trying the commands of a reward ---------------------------------------------------------

const testPlayer = ref('');
const tests = ref<Record<number, RewardTestResult['results'] | string>>({});
const testing = ref(false);

async function testReward(place: number): Promise<void> {
  const commands = parseCommands(form.value.rewards[place - 1] ?? '');
  if (testing.value || commands.length === 0 || testPlayer.value.trim() === '') return;
  testing.value = true;
  try {
    const { results } = await apiSend(
      'POST',
      url('/rewards/test'),
      {
        player: testPlayer.value.trim(),
        eventName: form.value.name.trim() || 'Test',
        place,
        commands,
      },
      rewardTestResultSchema,
    );
    tests.value = { ...tests.value, [place]: results };
  } catch (err) {
    tests.value = { ...tests.value, [place]: describeError(err) };
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="
      (value: boolean) => {
        open = value;
      }
    "
  >
    <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>
          {{
            clone
              ? t('competitions.clone')
              : editing
                ? t('competitions.edit')
                : t('competitions.new')
          }}
        </DialogTitle>
      </DialogHeader>
      <form class="flex flex-col gap-6" @submit.prevent="save">
        <section class="flex flex-col gap-4">
          <h3 class="text-sm font-semibold">{{ t('competitions.form.basics') }}</h3>
          <FieldGroup class="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel for="comp-name">{{ t('competitions.form.name') }}</FieldLabel>
              <Input id="comp-name" v-model="form.name" maxlength="80" />
            </Field>
            <Field>
              <FieldLabel for="comp-zone">{{ t('competitions.form.timezone') }}</FieldLabel>
              <Input
                id="comp-zone"
                v-model="zoneDraft"
                list="competitions-timezones"
                autocomplete="off"
                spellcheck="false"
                :aria-invalid="!zoneValid"
                @change="setZone"
              />
              <datalist id="competitions-timezones">
                <option v-for="zone in timezones" :key="zone" :value="zone" />
              </datalist>
            </Field>
            <Field>
              <FieldLabel for="comp-start">{{ t('competitions.form.start') }}</FieldLabel>
              <Input
                id="comp-start"
                v-model="form.start"
                type="datetime-local"
                :disabled="running"
              />
            </Field>
            <Field>
              <FieldLabel for="comp-end">{{ t('competitions.form.end') }}</FieldLabel>
              <Input
                id="comp-end"
                v-model="form.end"
                type="datetime-local"
                :aria-invalid="problems.includes('period')"
              />
            </Field>
          </FieldGroup>
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-muted-foreground text-sm">{{ t('competitions.form.period') }}:</span>
            <Button
              v-for="period in PERIODS"
              :key="period.key"
              type="button"
              variant="outline"
              size="sm"
              @click="applyPeriod(form, period.minutes)"
            >
              {{ t(`competitions.form.periods.${period.key}`) }}
            </Button>
          </div>
          <p class="text-muted-foreground text-xs">
            {{ running ? t('competitions.form.lockedRunning') : t('competitions.form.periodHint') }}
          </p>
        </section>

        <section class="flex flex-col gap-4">
          <h3 class="text-sm font-semibold">{{ t('competitions.form.counting') }}</h3>
          <Field>
            <FieldLabel for="comp-metric">{{ t('competitions.form.metric') }}</FieldLabel>
            <Select :model-value="form.metric" :disabled="running" @update:model-value="setMetric">
              <SelectTrigger id="comp-metric" class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="kind in METRIC_KINDS" :key="kind" :value="kind">
                  {{ t(`competitions.metric.${kind}`) }}
                </SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription v-if="form.metric === 'fish_caught'">
              {{ t('competitions.form.fishHint') }}
            </FieldDescription>
          </Field>
          <Field v-if="form.metric === 'mined'">
            <FieldLabel>{{ t('competitions.form.presets') }}</FieldLabel>
            <div class="flex flex-wrap gap-2">
              <Button
                v-for="preset in BLOCK_PRESET_IDS"
                :key="preset"
                type="button"
                size="sm"
                :variant="form.presets.includes(preset) ? 'default' : 'outline'"
                :aria-pressed="form.presets.includes(preset)"
                :disabled="running"
                @click="togglePreset(preset)"
              >
                {{ t(`competitions.metric.presets.${preset}`) }}
              </Button>
            </div>
          </Field>
          <Field v-if="form.metric === 'mined'">
            <FieldLabel for="comp-blocks">{{ t('competitions.form.blocks') }}</FieldLabel>
            <Textarea
              id="comp-blocks"
              v-model="form.blocks"
              rows="2"
              class="font-mono"
              spellcheck="false"
              :disabled="running"
              :aria-invalid="problems.includes('blocks')"
            />
            <FieldDescription>{{ t('competitions.form.blocksHint') }}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel for="comp-every">{{ t('competitions.form.countEvery') }}</FieldLabel>
            <Select
              :model-value="String(form.countEveryMinutes)"
              @update:model-value="setCountEvery"
            >
              <SelectTrigger id="comp-every" class="w-full sm:w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="minutes in COUNT_EVERY_CHOICES"
                  :key="minutes"
                  :value="String(minutes)"
                >
                  {{ t('competitions.form.everyMinutes', { count: minutes }) }}
                </SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>{{ t('competitions.form.countEveryHint') }}</FieldDescription>
          </Field>
        </section>

        <section class="flex flex-col gap-4">
          <h3 class="text-sm font-semibold">{{ t('competitions.form.participants') }}</h3>
          <FieldGroup class="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel for="comp-top">{{ t('competitions.form.top') }}</FieldLabel>
              <Select :model-value="String(form.top)" @update:model-value="setTop">
                <SelectTrigger id="comp-top" class="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="n in MAX_TOP" :key="n" :value="String(n)">{{ n }}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div class="flex items-center gap-3 self-end pb-2">
              <Switch id="comp-ops" v-model="form.excludeOperators" />
              <FieldLabel for="comp-ops">{{ t('competitions.form.excludeOperators') }}</FieldLabel>
            </div>
          </FieldGroup>
          <Field>
            <FieldLabel for="comp-excluded">{{ t('competitions.form.excluded') }}</FieldLabel>
            <PlayerPicker id="comp-excluded" v-model="form.excluded" :candidates="candidates" />
            <FieldDescription>{{ t('competitions.form.excludedHint') }}</FieldDescription>
          </Field>
        </section>

        <section class="flex flex-col gap-4">
          <h3 class="text-sm font-semibold">{{ t('competitions.form.rewards') }}</h3>
          <p class="text-muted-foreground text-xs">
            {{
              t('competitions.form.rewardsHint', {
                placeholders: placeholderList('command'),
              })
            }}
          </p>
          <p v-if="!canRewards" class="text-muted-foreground text-xs">
            {{ t('competitions.form.rewardsNeedConsole') }}
          </p>
          <Field v-if="canRewards">
            <FieldLabel for="comp-test-player">{{ t('competitions.form.testPlayer') }}</FieldLabel>
            <Input
              id="comp-test-player"
              v-model="testPlayer"
              maxlength="16"
              autocomplete="off"
              spellcheck="false"
              class="sm:w-64"
            />
            <FieldDescription>{{ t('competitions.form.testPlayerHint') }}</FieldDescription>
          </Field>
          <Field v-for="place in form.top" :key="place">
            <FieldLabel :for="`comp-reward-${place}`">
              {{ t('competitions.form.placeN', { place }) }}
            </FieldLabel>
            <Textarea
              :id="`comp-reward-${place}`"
              v-model="form.rewards[place - 1]"
              rows="2"
              class="font-mono"
              spellcheck="false"
              :disabled="!canRewards"
            />
            <div v-if="canRewards" class="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                :disabled="
                  testing ||
                  testPlayer.trim() === '' ||
                  parseCommands(form.rewards[place - 1] ?? '').length === 0
                "
                @click="testReward(place)"
              >
                {{ t('competitions.form.testReward') }}
              </Button>
            </div>
            <template v-if="tests[place] !== undefined">
              <p v-if="typeof tests[place] === 'string'" class="text-destructive text-xs">
                {{ tests[place] }}
              </p>
              <ul v-else class="flex flex-col gap-1 font-mono text-xs">
                <li v-for="(result, index) in tests[place]" :key="index">
                  <span :class="result.ok ? 'text-emerald-600' : 'text-destructive'">
                    {{ result.ok ? '✓' : '✗' }}
                  </span>
                  {{ result.command }}
                  <span v-if="result.reply" class="text-muted-foreground">
                    → {{ result.reply }}
                  </span>
                </li>
              </ul>
            </template>
          </Field>
        </section>

        <section class="flex flex-col gap-4">
          <h3 class="text-sm font-semibold">{{ t('competitions.form.messages') }}</h3>
          <FieldGroup class="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel for="comp-command">{{ t('competitions.form.command') }}</FieldLabel>
              <Input
                id="comp-command"
                v-model="form.messages.command"
                maxlength="31"
                class="font-mono"
                spellcheck="false"
              />
              <FieldDescription>{{ t('competitions.form.commandHint') }}</FieldDescription>
            </Field>
          </FieldGroup>
          <Field>
            <FieldLabel for="comp-description">{{ t('competitions.form.description') }}</FieldLabel>
            <Textarea
              id="comp-description"
              v-model="form.messages.description"
              rows="2"
              :maxlength="MAX_DESCRIPTION_LENGTH"
            />
            <FieldDescription>{{ t('competitions.form.descriptionHint') }}</FieldDescription>
          </Field>
          <div class="flex items-center gap-3">
            <Switch id="comp-join-notice" v-model="form.messages.joinNotice" />
            <FieldLabel for="comp-join-notice">{{ t('competitions.form.joinNotice') }}</FieldLabel>
          </div>
          <div class="flex items-center gap-3">
            <Switch id="comp-announce" v-model="form.messages.announceResults" />
            <FieldLabel for="comp-announce">
              {{ t('competitions.form.announceResults') }}
            </FieldLabel>
          </div>
          <p class="text-muted-foreground text-xs">
            {{ t('competitions.form.previewNote') }}
          </p>
          <Field v-for="key in TEMPLATES" :key="key">
            <FieldLabel :for="`comp-template-${key}`">
              {{ t(`competitions.form.templates.${key}`) }}
            </FieldLabel>
            <Textarea
              :id="`comp-template-${key}`"
              v-model="form.messages[key]"
              :rows="templateRows[key]"
              class="font-mono"
              spellcheck="false"
              :aria-invalid="unknownPlaceholders(key, form.messages[key]).length > 0"
            />
            <FieldDescription>
              {{ t('competitions.form.templateHint', { placeholders: placeholderList(key) }) }}
            </FieldDescription>
            <MessagePreview
              v-if="previewOf(key).length > 0"
              :lines="previewOf(key)"
              :label="t('competitions.form.preview')"
            />
          </Field>
        </section>

        <section class="flex flex-col gap-4">
          <h3 class="text-sm font-semibold">{{ t('competitions.form.announcements') }}</h3>
          <p class="text-muted-foreground text-xs">
            {{
              t('competitions.form.announcementsHint', {
                placeholders: placeholderList('announce'),
              })
            }}
          </p>
          <div
            v-for="(announcement, index) in form.announcements"
            :key="index"
            class="flex flex-col gap-3 rounded-md border p-3"
          >
            <FieldGroup class="grid gap-3 sm:grid-cols-[8rem_1fr_auto]">
              <Field>
                <FieldLabel :for="`comp-announce-minutes-${index}`">
                  {{ t('competitions.form.announcementMinutes') }}
                </FieldLabel>
                <Input
                  :id="`comp-announce-minutes-${index}`"
                  type="number"
                  min="0"
                  :max="MAX_ANNOUNCEMENT_MINUTES"
                  :model-value="String(announcement.minutesBefore)"
                  :aria-invalid="duplicateMoment(index)"
                  @update:model-value="(value: string) => setMinutes(announcement, value)"
                />
              </Field>
              <Field>
                <FieldLabel :for="`comp-announce-anchor-${index}`">
                  {{ t('competitions.form.announcementAnchor') }}
                </FieldLabel>
                <Select
                  :model-value="announcement.anchor"
                  @update:model-value="(value: unknown) => setAnchor(announcement, value)"
                >
                  <SelectTrigger :id="`comp-announce-anchor-${index}`" class="w-full sm:w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="start">{{
                      t('competitions.form.anchors.start')
                    }}</SelectItem>
                    <SelectItem value="end">{{ t('competitions.form.anchors.end') }}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <div class="flex items-end">
                <Button type="button" variant="ghost" size="sm" @click="removeAnnouncement(index)">
                  {{ t('competitions.form.removeAnnouncement') }}
                </Button>
              </div>
            </FieldGroup>
            <Field>
              <FieldLabel :for="`comp-announce-text-${index}`">
                {{ t('competitions.form.announcementText') }}
              </FieldLabel>
              <Textarea
                :id="`comp-announce-text-${index}`"
                v-model="announcement.text"
                rows="2"
                class="font-mono"
                spellcheck="false"
              />
              <FieldDescription v-if="duplicateMoment(index)" class="text-destructive">
                {{ t('competitions.form.duplicateMoment') }}
              </FieldDescription>
            </Field>
            <MessagePreview
              v-if="announcementPreview(announcement).length > 0"
              :lines="announcementPreview(announcement)"
              :label="t('competitions.form.preview')"
            />
          </div>
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              :disabled="form.announcements.length >= MAX_ANNOUNCEMENTS"
              @click="addAnnouncement"
            >
              {{ t('competitions.form.addAnnouncement') }}
            </Button>
          </div>
        </section>

        <Alert v-if="state.error" variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{{ state.error }}</AlertDescription>
        </Alert>

        <DialogFooter>
          <Button type="button" variant="outline" @click="open = false">
            {{ t('competitions.form.cancel') }}
          </Button>
          <Button type="submit" :disabled="state.busy || !valid">
            {{ state.busy ? t('competitions.form.saving') : t('competitions.form.save') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
