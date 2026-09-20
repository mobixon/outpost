<script setup lang="ts">
import {
  Button,
  Field,
  FieldDescription,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@outpost/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  BLOCK_PRESET_IDS,
  METRIC_KINDS,
  STAT_CATEGORIES,
  statPresetsOf,
  type BlockPreset,
  type StatPreset,
} from '../shared.js';
import { metricFormProblems, type MetricForm } from './form.js';

/** Picks what is counted: blocks mined, the fish caught, or another statistic of the game. */
defineProps<{
  /** Prefix of the ids of the fields, so that several pickers can share a page. */
  id: string;
  disabled?: boolean;
}>();
const form = defineModel<MetricForm>({ required: true });

const { t } = useI18n();

const problems = computed(() => metricFormProblems(form.value));
const statPresets = computed(() => statPresetsOf(form.value.category));

function setKind(value: unknown): void {
  if (METRIC_KINDS.some((kind) => kind === value)) form.value.kind = value as MetricForm['kind'];
}

function setCategory(value: unknown): void {
  if (STAT_CATEGORIES.some((category) => category === value)) {
    form.value.category = value as MetricForm['category'];
  }
}

function toggle<T extends BlockPreset | StatPreset>(list: T[], preset: T): T[] {
  return list.includes(preset) ? list.filter((entry) => entry !== preset) : [...list, preset];
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <Field>
      <FieldLabel :for="`${id}-kind`">{{ t('competitions.form.metric') }}</FieldLabel>
      <Select :model-value="form.kind" :disabled="disabled" @update:model-value="setKind">
        <SelectTrigger :id="`${id}-kind`" class="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem v-for="kind in METRIC_KINDS" :key="kind" :value="kind">
            {{ t(`competitions.metric.${kind}`) }}
          </SelectItem>
        </SelectContent>
      </Select>
      <FieldDescription v-if="form.kind === 'fish_caught'">
        {{ t('competitions.form.fishHint') }}
      </FieldDescription>
    </Field>

    <template v-if="form.kind === 'mined'">
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
            :disabled="disabled"
            @click="form.presets = toggle(form.presets, preset)"
          >
            {{ t(`competitions.metric.presets.${preset}`) }}
          </Button>
        </div>
      </Field>
      <Field>
        <FieldLabel :for="`${id}-blocks`">{{ t('competitions.form.blocks') }}</FieldLabel>
        <Textarea
          :id="`${id}-blocks`"
          v-model="form.blocks"
          rows="2"
          class="font-mono"
          spellcheck="false"
          :disabled="disabled"
          :aria-invalid="problems.includes('blocks')"
        />
        <FieldDescription>{{ t('competitions.form.blocksHint') }}</FieldDescription>
      </Field>
    </template>

    <template v-else-if="form.kind === 'stat'">
      <Field>
        <FieldLabel :for="`${id}-category`">{{ t('competitions.form.statCategory') }}</FieldLabel>
        <Select :model-value="form.category" :disabled="disabled" @update:model-value="setCategory">
          <SelectTrigger :id="`${id}-category`" class="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="category in STAT_CATEGORIES" :key="category" :value="category">
              {{ t(`competitions.metric.categories.${category}`) }}
            </SelectItem>
          </SelectContent>
        </Select>
        <FieldDescription>
          {{ t(`competitions.form.categoryHints.${form.category}`) }}
        </FieldDescription>
      </Field>
      <Field v-if="statPresets.length > 0">
        <FieldLabel>{{ t('competitions.form.presets') }}</FieldLabel>
        <div class="flex flex-wrap gap-2">
          <Button
            v-for="preset in statPresets"
            :key="preset"
            type="button"
            size="sm"
            :variant="form.statPresets.includes(preset) ? 'default' : 'outline'"
            :aria-pressed="form.statPresets.includes(preset)"
            :disabled="disabled"
            @click="form.statPresets = toggle(form.statPresets, preset)"
          >
            {{ t(`competitions.metric.statPresets.${preset}`) }}
          </Button>
        </div>
      </Field>
      <Field>
        <FieldLabel :for="`${id}-ids`">{{ t('competitions.form.statIds') }}</FieldLabel>
        <Textarea
          :id="`${id}-ids`"
          v-model="form.ids"
          rows="2"
          class="font-mono"
          spellcheck="false"
          :disabled="disabled"
          :aria-invalid="problems.includes('blocks')"
        />
        <FieldDescription>{{ t('competitions.form.statIdsHint') }}</FieldDescription>
      </Field>
    </template>
  </div>
</template>
