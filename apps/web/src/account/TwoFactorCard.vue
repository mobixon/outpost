<script setup lang="ts">
import { ShieldCheckIcon } from '@lucide/vue';
import {
  API_PREFIX,
  backupCodesSchema,
  twoFactorSetupSchema,
  type CurrentUser,
} from '@outpost/shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldLabel,
  Input,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  Spinner,
} from '@outpost/ui';
import { apiSend } from '@outpost/web-plugin-api';
import { renderSVG } from 'uqr';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useErrorMessage } from '../errors.js';
import BackupCodes from './BackupCodes.vue';
import { SudoCancelled, withSudo } from './sudo.js';

defineProps<{ user: CurrentUser }>();
const emit = defineEmits<{
  /** The account changed; reload it. */
  updated: [];
  /** The user confirmed that the backup codes are saved. */
  finished: [];
}>();

type View =
  | { name: 'idle' }
  | { name: 'setup'; secret: string; uri: string }
  | { name: 'codes'; codes: string[] }
  | { name: 'disable' };

const { t } = useI18n();
const errorMessage = useErrorMessage();
const view = ref<View>({ name: 'idle' });
const code = ref('');
const error = ref<string>();
const busy = ref(false);

const qrSvg = computed(() =>
  view.value.name === 'setup' ? renderSVG(view.value.uri, { border: 1 }) : '',
);
const groupedSecret = computed(() =>
  view.value.name === 'setup' ? (view.value.secret.match(/.{1,4}/g)?.join(' ') ?? '') : '',
);

async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  error.value = undefined;
  busy.value = true;
  try {
    await action();
  } catch (err) {
    if (!(err instanceof SudoCancelled)) error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

function show(next: View): void {
  code.value = '';
  error.value = undefined;
  view.value = next;
}

const startSetup = () =>
  run(async () => {
    const setup = await withSudo(() =>
      apiSend('POST', `${API_PREFIX}/me/2fa/setup`, {}, twoFactorSetupSchema),
    );
    show({ name: 'setup', ...setup });
  });

const confirmSetup = () =>
  run(async () => {
    const { backupCodes } = await withSudo(() =>
      apiSend('POST', `${API_PREFIX}/me/2fa/enable`, { code: code.value }, backupCodesSchema),
    );
    show({ name: 'codes', codes: backupCodes });
    emit('updated');
  });

const regenerate = () =>
  run(async () => {
    const { backupCodes } = await withSudo(() =>
      apiSend('POST', `${API_PREFIX}/me/2fa/backup-codes`, {}, backupCodesSchema),
    );
    show({ name: 'codes', codes: backupCodes });
    emit('updated');
  });

const confirmDisable = () =>
  run(async () => {
    await withSudo(() => apiSend('POST', `${API_PREFIX}/me/2fa/disable`, { code: code.value }));
    show({ name: 'idle' });
    emit('updated');
  });

function finishCodes(): void {
  show({ name: 'idle' });
  emit('finished');
}
</script>

<template>
  <Card data-testid="two-factor-card">
    <CardHeader>
      <CardTitle class="flex items-center gap-2">
        {{ t('account.twoFactor.title') }}
        <Badge :variant="user.twoFactorEnabled ? 'default' : 'secondary'">
          {{ user.twoFactorEnabled ? t('account.twoFactor.on') : t('account.twoFactor.off') }}
        </Badge>
      </CardTitle>
      <CardDescription>{{ t('account.twoFactor.description') }}</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <template v-if="view.name === 'setup'">
        <p class="text-sm">{{ t('account.twoFactor.scan') }}</p>
        <div class="flex flex-col items-start gap-4 sm:flex-row">
          <!-- eslint-disable-next-line vue/no-v-html -- SVG rendered locally by uqr from our own otpauth URI -->
          <div class="size-44 shrink-0 rounded-lg bg-white p-2" v-html="qrSvg" />
          <div class="flex flex-col gap-1">
            <span class="text-muted-foreground text-sm">{{
              t('account.twoFactor.secretLabel')
            }}</span>
            <code data-testid="totp-secret" class="font-mono text-sm break-all">{{
              groupedSecret
            }}</code>
          </div>
        </div>
        <form class="flex flex-col gap-3" @submit.prevent="confirmSetup">
          <Field>
            <FieldLabel>{{ t('account.twoFactor.confirmCode') }}</FieldLabel>
            <InputOTP
              v-model="code"
              :maxlength="6"
              autocomplete="one-time-code"
              :aria-label="t('account.twoFactor.confirmCode')"
            >
              <InputOTPGroup>
                <InputOTPSlot v-for="index in 6" :key="index" :index="index - 1" />
              </InputOTPGroup>
            </InputOTP>
          </Field>
          <div class="flex gap-2">
            <Button type="submit" :disabled="busy || code.length !== 6">
              <Spinner v-if="busy" />
              {{ t('account.twoFactor.confirm') }}
            </Button>
            <Button type="button" variant="ghost" @click="show({ name: 'idle' })">
              {{ t('account.twoFactor.cancel') }}
            </Button>
          </div>
        </form>
      </template>

      <BackupCodes v-else-if="view.name === 'codes'" :codes="view.codes" @done="finishCodes" />

      <form
        v-else-if="view.name === 'disable'"
        class="flex flex-col gap-3"
        @submit.prevent="confirmDisable"
      >
        <p class="text-sm">{{ t('account.twoFactor.disableText') }}</p>
        <Field>
          <FieldLabel for="disable-code">{{ t('account.twoFactor.code') }}</FieldLabel>
          <Input
            id="disable-code"
            v-model="code"
            autocomplete="one-time-code"
            class="max-w-48"
            required
          />
        </Field>
        <div class="flex gap-2">
          <Button type="submit" variant="destructive" :disabled="busy">
            <Spinner v-if="busy" />
            {{ t('account.twoFactor.disable') }}
          </Button>
          <Button type="button" variant="ghost" @click="show({ name: 'idle' })">
            {{ t('account.twoFactor.cancel') }}
          </Button>
        </div>
      </form>

      <div v-else-if="user.twoFactorEnabled" class="flex flex-wrap items-center gap-2">
        <span class="text-muted-foreground mr-auto text-sm">
          {{ t('account.twoFactor.codesLeft', { count: user.backupCodesLeft }) }}
        </span>
        <Button variant="outline" size="sm" :disabled="busy" @click="regenerate">
          {{ t('account.twoFactor.regenerate') }}
        </Button>
        <Button variant="destructive" size="sm" @click="show({ name: 'disable' })">
          {{ t('account.twoFactor.disable') }}
        </Button>
      </div>

      <div v-else>
        <Button :disabled="busy" @click="startSetup">
          <Spinner v-if="busy" />
          <ShieldCheckIcon v-else />
          {{ t('account.twoFactor.enable') }}
        </Button>
      </div>

      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
    </CardContent>
  </Card>
</template>
