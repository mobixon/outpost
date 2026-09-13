<script setup lang="ts">
import { MenuIcon, TriangleAlertIcon } from '@lucide/vue';
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
} from '@outpost/ui';
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterView, useRoute } from 'vue-router';
import SudoDialog from '../account/SudoDialog.vue';
import { storeLocale, SUPPORTED_LOCALES, type AppLocale } from '../i18n.js';
import { loadServers } from '../servers.js';
import { useShell } from '../shell.js';
import { saveAccountTheme, type ThemeMode } from '../theme/mode.js';
import FlashMessage from './FlashMessage.vue';
import NavList from './NavList.vue';
import ServerNav from './ServerNav.vue';
import ThemeToggle from './ThemeToggle.vue';
import UserMenu from './UserMenu.vue';

const shell = useShell();
const { t, locale } = useI18n();
const route = useRoute();

onMounted(() => {
  const session = shell.session;
  if (session?.status === 'active' && !session.twoFactorEnrollmentRequired) {
    // The sidebar lists the servers; pages show their own errors when this fails.
    loadServers().catch(() => undefined);
  }
});

const menuOpen = ref(false);
watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false;
  },
);

/** Signed in, the theme is also saved in the account; the browser remembers it anyway. */
function saveTheme(mode: ThemeMode): void {
  saveAccountTheme(mode).catch(() => undefined);
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
        <ServerNav />
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
          <ServerNav />
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
        <ThemeToggle @change="saveTheme" />
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
        <UserMenu v-if="shell.session?.user" :username="shell.session.user.username" />
      </header>

      <main class="bg-muted/40 flex-1 overflow-auto p-4 lg:p-8">
        <Alert v-if="shell.session === null" variant="destructive" class="mb-6">
          <TriangleAlertIcon />
          <AlertDescription>{{ t('shell.apiUnavailable') }}</AlertDescription>
        </Alert>
        <FlashMessage class="mx-auto mb-6 max-w-5xl" />
        <RouterView />
      </main>
    </div>
    <SudoDialog v-if="shell.session?.user" />
  </div>
</template>
