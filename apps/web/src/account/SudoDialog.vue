<script setup lang="ts">
import {
  API_PREFIX,
  currentUserSchema,
  identityListSchema,
  type CurrentUser,
  type ProviderInfo,
} from '@outpost/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  Spinner,
} from '@outpost/ui';
import { apiFetch, apiSend } from '@outpost/web-plugin-api';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { useErrorMessage } from '../errors.js';
import { startExternalAuth } from '../external-auth.js';
import { useShell } from '../shell.js';
import { cancelSudo, confirmSudo, sudoRequest } from './sudo.js';

// Accounts with a password confirm it. Accounts that sign in through a provider confirm with a
// two-factor code or by signing in at the provider again.
const { t } = useI18n();
const errorMessage = useErrorMessage();
const shell = useShell();
const route = useRoute();
const user = ref<CurrentUser | null>(null);
const linkedProviders = ref<ProviderInfo[]>([]);
const secret = ref('');
const error = ref<string>();
const busy = ref(false);

const open = computed({
  get: () => sudoRequest.value !== null,
  set: (value: boolean) => {
    if (!value) cancelSudo();
  },
});

const mode = computed(() => {
  if (user.value === null) return 'loading';
  if (user.value.hasPassword) return 'password';
  if (user.value.twoFactorEnabled) return 'code';
  return linkedProviders.value.length > 0 ? 'provider' : 'none';
});

watch(open, async (value) => {
  if (!value) return;
  secret.value = '';
  error.value = undefined;
  try {
    const [me, { identities }] = await Promise.all([
      apiFetch(`${API_PREFIX}/me`, currentUserSchema),
      apiFetch(`${API_PREFIX}/me/identities`, identityListSchema),
    ]);
    const configured = shell.session?.providers ?? [];
    linkedProviders.value = configured.filter((provider) =>
      identities.some((identity) => identity.provider === provider.id),
    );
    user.value = me;
  } catch (err) {
    error.value = errorMessage(err);
  }
});

async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = undefined;
  try {
    await action();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

const submit = () =>
  run(() =>
    confirmSudo(mode.value === 'password' ? { password: secret.value } : { code: secret.value }),
  );

const confirmWith = (provider: string) =>
  run(() => startExternalAuth(provider, { intent: 'sudo' }, route.fullPath));

async function signOut(): Promise<void> {
  try {
    await apiSend('POST', `${API_PREFIX}/auth/logout`);
  } finally {
    window.location.assign('/login');
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-sm">
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <DialogHeader>
          <DialogTitle>{{
            mode === 'password' ? t('account.sudo.title') : t('account.sudo.titleOther')
          }}</DialogTitle>
          <DialogDescription>
            <template v-if="mode === 'password'">{{ t('account.sudo.text') }}</template>
            <template v-else-if="mode === 'code'">{{ t('account.sudo.codeText') }}</template>
            <template v-else-if="mode === 'provider'">{{
              t('account.sudo.providerText')
            }}</template>
            <template v-else-if="mode === 'none'">{{ t('account.sudo.noMethod') }}</template>
          </DialogDescription>
        </DialogHeader>
        <div v-if="mode === 'loading' && !error" class="flex justify-center py-2">
          <Spinner />
        </div>
        <Field v-if="mode === 'password'">
          <FieldLabel for="sudo-password">{{ t('auth.password') }}</FieldLabel>
          <Input
            id="sudo-password"
            v-model="secret"
            type="password"
            autocomplete="current-password"
            required
          />
        </Field>
        <Field v-if="mode === 'code'">
          <FieldLabel for="sudo-code">{{ t('account.twoFactor.code') }}</FieldLabel>
          <Input id="sudo-code" v-model="secret" autocomplete="one-time-code" required />
        </Field>
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
        <DialogFooter class="flex-col gap-2 sm:flex-col">
          <Button v-if="mode === 'password' || mode === 'code'" type="submit" :disabled="busy">
            <Spinner v-if="busy" />
            {{ t('account.sudo.confirm') }}
          </Button>
          <Button
            v-for="provider in mode === 'loading' || mode === 'none' ? [] : linkedProviders"
            :key="provider.id"
            type="button"
            variant="outline"
            :disabled="busy"
            @click="confirmWith(provider.id)"
          >
            {{ t('auth.continueWith', { provider: provider.name }) }}
          </Button>
          <Button v-if="mode === 'none'" type="button" variant="outline" @click="signOut">
            {{ t('nav.signOut') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
