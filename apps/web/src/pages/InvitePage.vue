<script setup lang="ts">
import { CircleAlertIcon, InfoIcon } from '@lucide/vue';
import {
  API_PREFIX,
  invitationPreviewSchema,
  loginResultSchema,
  PASSWORD_MIN_LENGTH,
  usernameSchema,
  type InvitationPreview,
} from '@outpost/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Spinner,
} from '@outpost/ui';
import { apiFetch, apiSend } from '@outpost/web-plugin-api';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import { useErrorMessage } from '../errors.js';
import { startExternalAuth } from '../external-auth.js';
import AuthLayout from '../layout/AuthLayout.vue';
import ProviderButtons from '../layout/ProviderButtons.vue';
import { useShell } from '../shell.js';

const { t, locale } = useI18n();
const errorMessage = useErrorMessage();
const shell = useShell();
const route = useRoute();

const token = String(route.params['token'] ?? '');
const providers = shell.session?.providers ?? [];
const signedInAs = shell.session?.user?.username ?? null;
const preview = ref<InvitationPreview | null>(null);
const invalid = ref(false);
const form = reactive({ username: '', password: '', repeat: '' });
const error = ref<string>();
const busy = ref(false);

onMounted(async () => {
  try {
    preview.value = await apiFetch(
      `${API_PREFIX}/invite/${encodeURIComponent(token)}`,
      invitationPreviewSchema,
    );
  } catch {
    invalid.value = true;
  }
});

const description = computed(() => {
  if (preview.value === null) return undefined;
  const { invitedBy, serverName, role, isSuperadmin } = preview.value;
  const by = invitedBy ?? t('invite.someone');
  if (serverName !== null && role !== null) {
    return t('invite.textServer', { by, server: serverName, role: t(`roles.${role}`) });
  }
  return isSuperadmin ? t('invite.textAdmin', { by }) : t('invite.text', { by });
});

async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  error.value = undefined;
  busy.value = true;
  try {
    await action();
  } catch (err) {
    error.value = errorMessage(err);
    busy.value = false;
  }
}

function acceptWithPassword(): void {
  if (form.password !== form.repeat) {
    error.value = t('auth.passwordMismatch');
    return;
  }
  void run(async () => {
    await apiSend(
      'POST',
      `${API_PREFIX}/invite/${encodeURIComponent(token)}/accept`,
      { username: form.username, password: form.password },
      loginResultSchema,
    );
    // A full reload picks up the new session; administrators continue with 2FA enrollment.
    window.location.assign('/');
  });
}

function acceptWith(provider: string): void {
  const username = usernameSchema.safeParse(form.username);
  if (!username.success) {
    error.value = t('invite.usernameFirst');
    return;
  }
  void run(() =>
    startExternalAuth(
      provider,
      { intent: 'invite', token, username: username.data },
      `/invite/${token}`,
    ),
  );
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(locale.value, { dateStyle: 'long', timeStyle: 'short' });
</script>

<template>
  <AuthLayout
    :title="invalid ? t('invite.invalidTitle') : t('invite.title')"
    :description="invalid ? undefined : description"
  >
    <div v-if="invalid" class="flex flex-col gap-4">
      <p class="text-sm">{{ t('invite.invalidText') }}</p>
      <Button as-child variant="outline">
        <RouterLink to="/login">{{ t('invite.toLogin') }}</RouterLink>
      </Button>
    </div>

    <div v-else-if="preview === null" class="flex justify-center py-6">
      <Spinner class="size-6" />
    </div>

    <form v-else class="flex flex-col gap-6" @submit.prevent="acceptWithPassword">
      <Alert v-if="signedInAs">
        <InfoIcon />
        <AlertDescription>{{ t('invite.signedIn', { username: signedInAs }) }}</AlertDescription>
      </Alert>
      <FieldGroup>
        <Field>
          <FieldLabel for="invite-username">{{ t('auth.username') }}</FieldLabel>
          <Input id="invite-username" v-model="form.username" autocomplete="username" required />
          <FieldDescription>{{ t('auth.usernameHint') }}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel for="invite-password">{{ t('auth.password') }}</FieldLabel>
          <Input
            id="invite-password"
            v-model="form.password"
            type="password"
            autocomplete="new-password"
            :minlength="PASSWORD_MIN_LENGTH"
            required
          />
          <FieldDescription>{{
            t('auth.passwordHint', { min: PASSWORD_MIN_LENGTH })
          }}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel for="invite-repeat">{{ t('auth.passwordRepeat') }}</FieldLabel>
          <Input
            id="invite-repeat"
            v-model="form.repeat"
            type="password"
            autocomplete="new-password"
            required
          />
        </Field>
      </FieldGroup>
      <Alert v-if="error" variant="destructive">
        <CircleAlertIcon />
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
      <Button type="submit" :disabled="busy">
        <Spinner v-if="busy" />
        {{ t('auth.createAccount') }}
      </Button>
      <ProviderButtons :providers="providers" :disabled="busy" @select="acceptWith" />
      <p class="text-muted-foreground text-center text-xs">
        {{ t('invite.validUntil', { date: formatDate(preview.expiresAt) }) }}
      </p>
    </form>
  </AuthLayout>
</template>
