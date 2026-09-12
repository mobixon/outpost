<script setup lang="ts">
import { API_PREFIX, PASSWORD_MIN_LENGTH } from '@outpost/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Spinner,
} from '@outpost/ui';
import { apiSend } from '@outpost/web-plugin-api';
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useErrorMessage } from '../errors.js';
import { SudoCancelled, withSudo } from './sudo.js';

// Accounts created through a login provider have no password yet: they set a first one.
const props = defineProps<{ hasPassword: boolean }>();
const emit = defineEmits<{ updated: [] }>();

const { t } = useI18n();
const errorMessage = useErrorMessage();
const form = reactive({ current: '', next: '', repeat: '' });
const error = ref<string>();
const changed = ref(false);
const busy = ref(false);

async function submit(): Promise<void> {
  if (busy.value) return;
  error.value = undefined;
  changed.value = false;
  if (form.next !== form.repeat) {
    error.value = t('auth.passwordMismatch');
    return;
  }
  busy.value = true;
  try {
    if (props.hasPassword) {
      await apiSend('POST', `${API_PREFIX}/me/password`, {
        currentPassword: form.current,
        newPassword: form.next,
      });
    } else {
      await withSudo(() =>
        apiSend('POST', `${API_PREFIX}/me/password`, { newPassword: form.next }),
      );
      emit('updated');
    }
    Object.assign(form, { current: '', next: '', repeat: '' });
    changed.value = true;
  } catch (err) {
    if (!(err instanceof SudoCancelled)) error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>{{ t('account.password.title') }}</CardTitle>
      <CardDescription v-if="!hasPassword">{{ t('account.password.setText') }}</CardDescription>
    </CardHeader>
    <CardContent>
      <form class="flex max-w-sm flex-col gap-4" @submit.prevent="submit">
        <FieldGroup>
          <Field v-if="hasPassword">
            <FieldLabel for="password-current">{{ t('account.password.current') }}</FieldLabel>
            <Input
              id="password-current"
              v-model="form.current"
              type="password"
              autocomplete="current-password"
              required
            />
          </Field>
          <Field>
            <FieldLabel for="password-new">{{ t('account.password.new') }}</FieldLabel>
            <Input
              id="password-new"
              v-model="form.next"
              type="password"
              autocomplete="new-password"
              :minlength="PASSWORD_MIN_LENGTH"
              required
            />
          </Field>
          <Field>
            <FieldLabel for="password-repeat">{{ t('account.password.repeat') }}</FieldLabel>
            <Input
              id="password-repeat"
              v-model="form.repeat"
              type="password"
              autocomplete="new-password"
              required
            />
          </Field>
        </FieldGroup>
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
        <Alert v-if="changed">
          <AlertDescription>{{
            hasPassword ? t('account.password.changed') : t('account.password.setDone')
          }}</AlertDescription>
        </Alert>
        <Button type="submit" class="self-start" :disabled="busy">
          <Spinner v-if="busy" />
          {{ hasPassword ? t('account.password.submit') : t('account.password.set') }}
        </Button>
      </form>
    </CardContent>
  </Card>
</template>
