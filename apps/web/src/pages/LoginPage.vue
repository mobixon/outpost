<script setup lang="ts">
import { CircleAlertIcon } from '@lucide/vue';
import { API_PREFIX, loginResultSchema } from '@outpost/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  Spinner,
} from '@outpost/ui';
import { ApiError, apiSend } from '@outpost/web-plugin-api';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { useErrorMessage } from '../errors.js';
import { startExternalAuth } from '../external-auth.js';
import AuthLayout from '../layout/AuthLayout.vue';
import ProviderButtons from '../layout/ProviderButtons.vue';
import { safeNextPath } from '../session.js';
import { useShell } from '../shell.js';

const { t } = useI18n();
const errorMessage = useErrorMessage();
const shell = useShell();
const route = useRoute();
const providers = shell.session?.providers ?? [];

// After a reload during the second step, the pending login continues with the code.
const step = ref<'password' | 'code'>(shell.session?.status === 'mfa' ? 'code' : 'password');
const useBackupCode = ref(false);
const username = ref('');
const password = ref('');
const code = ref('');
const error = ref<string>();
const busy = ref(false);

async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  error.value = undefined;
  busy.value = true;
  try {
    await action();
  } catch (err) {
    error.value = errorMessage(err);
    code.value = '';
    // The pending login ended (too many wrong codes or timeout): start over with the password.
    if (err instanceof ApiError && err.status === 401 && step.value === 'code')
      step.value = 'password';
  } finally {
    busy.value = false;
  }
}

// Reloading loads the new session and the enabled modules; the router then continues to the
// page from `?next=` (see redirectFor), so no user-supplied URL is ever assigned here.
const finish = (): void => window.location.reload();

const submitPassword = () =>
  run(async () => {
    const result = await apiSend(
      'POST',
      `${API_PREFIX}/auth/login`,
      { username: username.value, password: password.value },
      loginResultSchema,
    );
    password.value = '';
    if (result.status === 'mfa') step.value = 'code';
    else finish();
  });

const submitCode = () =>
  run(async () => {
    await apiSend('POST', `${API_PREFIX}/auth/login/2fa`, { code: code.value }, loginResultSchema);
    finish();
  });

const signInWith = (provider: string) =>
  run(() => startExternalAuth(provider, { intent: 'login' }, safeNextPath(route.query['next'])));

const startOver = () =>
  run(async () => {
    await apiSend('POST', `${API_PREFIX}/auth/logout`);
    step.value = 'password';
  });

function toggleBackupCode(): void {
  useBackupCode.value = !useBackupCode.value;
  code.value = '';
  error.value = undefined;
}
</script>

<template>
  <AuthLayout
    :title="step === 'password' ? t('auth.loginTitle') : t('auth.codeTitle')"
    :description="
      step === 'password'
        ? undefined
        : useBackupCode
          ? t('auth.backupCodeText')
          : t('auth.codeText')
    "
  >
    <form v-if="step === 'password'" class="flex flex-col gap-6" @submit.prevent="submitPassword">
      <FieldGroup>
        <Field>
          <FieldLabel for="login-username">{{ t('auth.username') }}</FieldLabel>
          <Input id="login-username" v-model="username" autocomplete="username" required />
        </Field>
        <Field>
          <FieldLabel for="login-password">{{ t('auth.password') }}</FieldLabel>
          <Input
            id="login-password"
            v-model="password"
            type="password"
            autocomplete="current-password"
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
        {{ t('auth.signIn') }}
      </Button>
      <ProviderButtons :providers="providers" :disabled="busy" @select="signInWith" />
    </form>

    <form v-else class="flex flex-col gap-6" @submit.prevent="submitCode">
      <Field v-if="useBackupCode">
        <FieldLabel for="login-backup-code">{{ t('auth.backupCode') }}</FieldLabel>
        <Input id="login-backup-code" v-model="code" autocomplete="off" required />
      </Field>
      <InputOTP
        v-else
        v-model="code"
        :maxlength="6"
        autocomplete="one-time-code"
        :aria-label="t('auth.codeTitle')"
        @complete="submitCode"
      >
        <InputOTPGroup>
          <InputOTPSlot
            v-for="index in 6"
            :key="index"
            :index="index - 1"
            class="size-10 text-base"
          />
        </InputOTPGroup>
      </InputOTP>
      <Alert v-if="error" variant="destructive">
        <CircleAlertIcon />
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
      <div class="flex flex-col gap-2">
        <Button type="submit" :disabled="busy || code.length === 0">
          <Spinner v-if="busy" />
          {{ t('auth.verify') }}
        </Button>
        <Button type="button" variant="ghost" @click="toggleBackupCode">
          {{ useBackupCode ? t('auth.useAuthenticator') : t('auth.useBackupCode') }}
        </Button>
        <Button type="button" variant="link" @click="startOver">{{ t('auth.startOver') }}</Button>
      </div>
    </form>
  </AuthLayout>
</template>
