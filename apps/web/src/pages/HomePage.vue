<script setup lang="ts">
import { PlusIcon, ServerIcon } from '@lucide/vue';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
} from '@outpost/ui';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { useErrorMessage } from '../errors.js';
import { loadServers, servers } from '../servers.js';
import AddServerDialog from '../servers/AddServerDialog.vue';
import { useShell } from '../shell.js';

const { t } = useI18n();
const errorMessage = useErrorMessage();
const shell = useShell();
const isSuperadmin = shell.session?.user?.isSuperadmin === true;
const adding = ref(false);
const error = ref<string>();

onMounted(() => {
  loadServers().catch((err: unknown) => {
    error.value = errorMessage(err);
  });
});
</script>

<template>
  <section class="mx-auto flex max-w-5xl flex-col gap-6">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-2xl font-semibold tracking-tight">{{ t('home.title') }}</h1>
      <Button v-if="isSuperadmin" @click="adding = true">
        <PlusIcon />
        {{ t('home.add') }}
      </Button>
    </div>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div v-else-if="servers === null" class="flex justify-center py-12">
      <Spinner class="size-6" />
    </div>

    <div
      v-else-if="servers.length === 0"
      class="bg-background flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center"
    >
      <ServerIcon class="text-muted-foreground size-10" aria-hidden="true" />
      <h2 class="text-lg font-medium">{{ t('home.emptyTitle') }}</h2>
      <p class="text-muted-foreground max-w-md text-sm">
        {{ isSuperadmin ? t('home.emptyAdmin') : t('home.emptyMember') }}
      </p>
    </div>

    <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <RouterLink
        v-for="server in servers"
        :key="server.id"
        :to="`/servers/${server.slug}`"
        class="focus-visible:ring-ring rounded-xl focus-visible:ring-2 focus-visible:outline-none"
      >
        <Card class="hover:ring-primary/40 h-full transition-shadow">
          <CardHeader>
            <CardTitle class="flex items-center gap-2">
              <ServerIcon class="text-muted-foreground size-4" aria-hidden="true" />
              <span class="truncate">{{ server.name }}</span>
            </CardTitle>
            <CardDescription class="font-mono">{{ server.slug }}</CardDescription>
            <div class="flex flex-wrap gap-2 pt-2">
              <Badge variant="secondary">
                {{ server.role ? t(`roles.${server.role}`) : t('account.superadmin') }}
              </Badge>
              <Badge v-if="!server.connected" variant="outline">{{ t('home.notConnected') }}</Badge>
            </div>
          </CardHeader>
        </Card>
      </RouterLink>
    </div>

    <AddServerDialog v-if="isSuperadmin" v-model:open="adding" />
  </section>
</template>
