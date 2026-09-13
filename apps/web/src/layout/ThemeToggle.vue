<script setup lang="ts">
import { MonitorIcon, MoonIcon, SunIcon } from '@lucide/vue';
import { ToggleGroup, ToggleGroupItem } from '@outpost/ui';
import { useI18n } from 'vue-i18n';
import { isThemeMode, themeMode, type ThemeMode } from '../theme/mode.js';

const emit = defineEmits<{ change: [mode: ThemeMode] }>();
const { t } = useI18n();

const options = [
  { value: 'light', icon: SunIcon },
  { value: 'system', icon: MonitorIcon },
  { value: 'dark', icon: MoonIcon },
] as const satisfies readonly { value: ThemeMode; icon: unknown }[];

function select(value: unknown): void {
  // A single-choice toggle group emits an empty value when the active item is clicked again.
  if (!isThemeMode(value)) return;
  themeMode.value = value;
  emit('change', value);
}
</script>

<template>
  <ToggleGroup
    type="single"
    variant="outline"
    size="sm"
    :model-value="themeMode"
    :aria-label="t('theme.label')"
    @update:model-value="select"
  >
    <ToggleGroupItem
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      :aria-label="t(`theme.${option.value}`)"
      :title="t(`theme.${option.value}`)"
    >
      <component :is="option.icon" />
    </ToggleGroupItem>
  </ToggleGroup>
</template>
