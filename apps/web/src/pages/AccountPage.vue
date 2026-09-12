<script setup lang="ts">
import { ShieldAlertIcon } from '@lucide/vue';
import { API_PREFIX, currentUserSchema, type CurrentUser } from '@outpost/shared';
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle } from '@outpost/ui';
import { apiFetch } from '@outpost/web-plugin-api';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import IdentitiesCard from '../account/IdentitiesCard.vue';
import PasswordCard from '../account/PasswordCard.vue';
import SessionsCard from '../account/SessionsCard.vue';
import TwoFactorCard from '../account/TwoFactorCard.vue';
import { useShell } from '../shell.js';

const { t, locale } = useI18n();
const shell = useShell();
const user = ref<CurrentUser | null>(shell.session?.user ?? null);
const enrollmentRequired = shell.session?.twoFactorEnrollmentRequired ?? false;

async function refresh(): Promise<void> {
  user.value = await apiFetch(`${API_PREFIX}/me`, currentUserSchema);
}

function onBackupCodesSaved(): void {
  // Enrollment is complete: reload to open the whole panel.
  if (enrollmentRequired) window.location.assign('/');
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(locale.value, { dateStyle: 'long' });
</script>

<template>
  <section class="mx-auto flex max-w-3xl flex-col gap-6">
    <h1 class="text-2xl font-semibold tracking-tight">{{ t('account.title') }}</h1>

    <Alert v-if="enrollmentRequired && !user?.twoFactorEnabled">
      <ShieldAlertIcon />
      <AlertDescription>{{ t('account.enrollmentRequired') }}</AlertDescription>
    </Alert>

    <template v-if="user">
      <Card>
        <CardHeader>
          <CardTitle>{{ t('account.profile') }}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl class="grid grid-cols-[max-content_1fr] gap-x-8 gap-y-2 text-sm">
            <dt class="text-muted-foreground">{{ t('auth.username') }}</dt>
            <dd class="font-mono">{{ user.username }}</dd>
            <dt class="text-muted-foreground">{{ t('account.role') }}</dt>
            <dd>{{ user.isSuperadmin ? t('account.superadmin') : t('account.user') }}</dd>
            <dt class="text-muted-foreground">{{ t('account.memberSince') }}</dt>
            <dd>{{ formatDate(user.createdAt) }}</dd>
          </dl>
        </CardContent>
      </Card>
      <TwoFactorCard :user="user" @updated="refresh" @finished="onBackupCodesSaved" />
      <PasswordCard :has-password="user.hasPassword" @updated="refresh" />
      <IdentitiesCard />
      <SessionsCard />
    </template>
  </section>
</template>
