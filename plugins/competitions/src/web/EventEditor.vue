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
  isValidTimezone,
  MAX_DESCRIPTION_LENGTH,
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
  changeTimezone,
  emptyForm,
  fromEvent,
  parseBlocks,
  PERIODS,
  problemsOf,
  toInput,
} from './form.js';
import PlayerPicker from './PlayerPicker.vue';
import { describe } from './util.js';

const props = defineProps<{ event: CompetitionEvent | null }>();
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
const running = computed(() => props.event?.state === 'active');
const problems = computed(() => problemsOf(form.value));
const zoneValid = computed(() => isValidTimezone(zoneDraft.value.trim()));
const valid = computed(() => problems.value.length === 0 && zoneValid.value);

watch(open, async (isOpen) => {
  if (!isOpen) return;
  form.value = props.event === null ? emptyForm(browserZone) : fromEvent(props.event);
  zoneDraft.value = form.value.timezone;
  state.error = null;
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
    if (props.event === null) await apiSend('POST', url('/events'), body, eventSchema);
    else await apiSend('PUT', url(`/events/${props.event.id}`), body, eventSchema);
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
    endsAt: new Date(Date.now() + (3 * 24 + 5) * 3_600_000).toISOString(),
    timezone: isValidTimezone(value.timezone) ? value.timezone : 'UTC',
    metric: { kind: 'mined', presets: value.presets, blocks: parseBlocks(value.blocks) },
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
        <DialogTitle>{{ event ? t('competitions.edit') : t('competitions.new') }}</DialogTitle>
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
              @click="applyPeriod(form, period.hours)"
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
          <Field>
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
