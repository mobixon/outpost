<script setup lang="ts">
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
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useErrorMessage } from '../errors.js';
import { cancelSudo, confirmSudo, sudoRequest } from './sudo.js';

const { t } = useI18n();
const errorMessage = useErrorMessage();
const password = ref('');
const error = ref<string>();
const busy = ref(false);

const open = computed({
  get: () => sudoRequest.value !== null,
  set: (value: boolean) => {
    if (!value) cancelSudo();
  },
});

watch(open, (value) => {
  if (value) {
    password.value = '';
    error.value = undefined;
  }
});

async function submit(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = undefined;
  try {
    await confirmSudo(password.value);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-sm">
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <DialogHeader>
          <DialogTitle>{{ t('account.sudo.title') }}</DialogTitle>
          <DialogDescription>{{ t('account.sudo.text') }}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel for="sudo-password">{{ t('auth.password') }}</FieldLabel>
          <Input
            id="sudo-password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
          />
        </Field>
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
        <DialogFooter>
          <Button type="submit" :disabled="busy">
            <Spinner v-if="busy" />
            {{ t('account.sudo.confirm') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
