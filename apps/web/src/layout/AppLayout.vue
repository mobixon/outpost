<script setup lang="ts">
import { MenuIcon, MonitorIcon, MoonIcon, SunIcon, TriangleAlertIcon } from '@lucide/vue';
import {
  Alert,
  AlertDescription,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  ToggleGroup,
  ToggleGroupItem,
} from '@outpost/ui';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterView, useRoute } from 'vue-router';
import { storeLocale, SUPPORTED_LOCALES, type AppLocale } from '../i18n.js';
import { useShell } from '../shell.js';
import { themeMode, type ThemeMode } from '../theme/mode.js';
import NavList from './NavList.vue';

const shell = useShell();
const { t, locale } = useI18n();
const route = useRoute();

const menuOpen = ref(false);
watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false;
  },
);

const themeOptions = [
  { value: 'light', icon: SunIcon },
  { value: 'system', icon: MonitorIcon },
  { value: 'dark', icon: MoonIcon },
] as const satisfies readonly { value: ThemeMode; icon: unknown }[];

function setTheme(value: unknown): void {
  // A single-choice toggle group emits an empty value when the active item is clicked again.
  if (themeOptions.some((option) => option.value === value)) themeMode.value = value as ThemeMode;
}

function setLocale(value: unknown): void {
  if ((SUPPORTED_LOCALES as readonly unknown[]).includes(value)) {
    locale.value = value as AppLocale;
    storeLocale(value as AppLocale);
  }
}
</script>

<template>
  <div class="flex h-full">
    <aside
      class="bg-sidebar text-sidebar-foreground border-sidebar-border hidden w-64 shrink-0 flex-col border-r lg:flex"
    >
      <div class="flex items-center gap-2 px-5 py-4">
        <img src="/favicon.svg" alt="" class="size-7" />
        <span class="text-lg font-semibold">{{ t('app.name') }}</span>
      </div>
      <div class="px-3">
        <NavList :items="shell.navItems" />
      </div>
    </aside>

    <Sheet v-model:open="menuOpen">
      <SheetContent side="left" class="w-72 gap-2 p-0 lg:hidden">
        <SheetHeader class="px-5 py-4">
          <SheetTitle class="flex items-center gap-2 text-lg">
            <img src="/favicon.svg" alt="" class="size-7" />
            {{ t('app.name') }}
          </SheetTitle>
          <SheetDescription class="sr-only">{{ t('nav.main') }}</SheetDescription>
        </SheetHeader>
        <div class="px-3">
          <NavList :items="shell.navItems" />
        </div>
      </SheetContent>
    </Sheet>

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="bg-background flex items-center gap-2 border-b px-4 py-2">
        <Button
          class="lg:hidden"
          variant="ghost"
          size="icon"
          :aria-label="t('nav.openMenu')"
          @click="menuOpen = true"
        >
          <MenuIcon />
        </Button>
        <span class="font-semibold lg:hidden">{{ t('app.name') }}</span>
        <div class="flex-1" />
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          :model-value="themeMode"
          :aria-label="t('theme.label')"
          @update:model-value="setTheme"
        >
          <ToggleGroupItem
            v-for="option in themeOptions"
            :key="option.value"
            :value="option.value"
            :aria-label="t(`theme.${option.value}`)"
            :title="t(`theme.${option.value}`)"
          >
            <component :is="option.icon" />
          </ToggleGroupItem>
        </ToggleGroup>
        <Select :model-value="locale" @update:model-value="setLocale">
          <SelectTrigger size="sm" class="w-32" :aria-label="t('locale.label')">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="code in SUPPORTED_LOCALES" :key="code" :value="code">
              {{ t(`locale.${code}`) }}
            </SelectItem>
          </SelectContent>
        </Select>
      </header>

      <main class="bg-muted/40 flex-1 overflow-auto p-4 lg:p-8">
        <Alert v-if="!shell.apiAvailable" variant="destructive" class="mb-6">
          <TriangleAlertIcon />
          <AlertDescription>{{ t('shell.apiUnavailable') }}</AlertDescription>
        </Alert>
        <RouterView />
      </main>
    </div>
  </div>
</template>
