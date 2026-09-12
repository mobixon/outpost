<script setup lang="ts">
import { CircleAlertIcon } from '@lucide/vue';
import { API_PREFIX, loginResultSchema, PASSWORD_MIN_LENGTH } from '@outpost/shared';
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
import { apiSend } from '@outpost/web-plugin-api';
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useErrorMessage } from '../errors.js';
import AuthLayout from '../layout/AuthLayout.vue';

const { t } = useI18n();
const errorMessage = useErrorMessage();
const form = reactive({ token: '', username: '', password: '', repeat: '' });
const error = ref<string>();
const busy = ref(false);

async function submit(): Promise<void> {
  if (busy.value) return;
  error.value = undefined;
  if (form.password !== form.repeat) {
    error.value = t('auth.passwordMismatch');
    return;
  }
  busy.value = true;
  try {
    await apiSend(
      'POST',
      `${API_PREFIX}/setup`,
      { token: form.token, username: form.username, password: form.password },
      loginResultSchema,
    );
    // A full reload picks up the new session; administrators continue with 2FA enrollment.
    window.location.assign('/account');
  } catch (err) {
    error.value = errorMessage(err);
    busy.value = false;
  }
}
</script>

<template>
  <AuthLayout :title="t('auth.setupTitle')" :description="t('auth.setupText')">
    <form class="flex flex-col gap-6" @submit.prevent="submit">
      <FieldGroup>
        <Field>
          <FieldLabel for="setup-token">{{ t('auth.setupToken') }}</FieldLabel>
          <Input id="setup-token" v-model="form.token" autocomplete="off" required />
        </Field>
        <Field>
          <FieldLabel for="setup-username">{{ t('auth.username') }}</FieldLabel>
          <Input id="setup-username" v-model="form.username" autocomplete="username" required />
          <FieldDescription>{{ t('auth.usernameHint') }}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel for="setup-password">{{ t('auth.password') }}</FieldLabel>
          <Input
            id="setup-password"
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
          <FieldLabel for="setup-repeat">{{ t('auth.passwordRepeat') }}</FieldLabel>
          <Input
            id="setup-repeat"
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
    </form>
  </AuthLayout>
</template>
