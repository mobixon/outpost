<script setup lang="ts">
import { CheckIcon, CopyIcon } from '@lucide/vue';
import { Alert, AlertDescription, Button, Input } from '@outpost/ui';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

// A new invitation link: shown once, since only a hash of its token is stored.
const props = defineProps<{ link: string }>();

const { t } = useI18n();
const copied = ref(false);

watch(
  () => props.link,
  () => {
    copied.value = false;
  },
);

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.link);
    copied.value = true;
  } catch {
    // The clipboard needs HTTPS; the link stays visible for copying by hand.
  }
}
</script>

<template>
  <Alert data-testid="invitation-created">
    <AlertDescription class="flex flex-col gap-3">
      <span>{{ t('admin.invitations.created') }}</span>
      <div class="flex gap-2">
        <Input
          :model-value="link"
          readonly
          class="font-mono"
          data-testid="invitation-link"
          :aria-label="t('admin.invitations.link')"
          @focus="($event.target as HTMLInputElement).select()"
        />
        <Button variant="outline" @click="copy">
          <CheckIcon v-if="copied" />
          <CopyIcon v-else />
          {{ copied ? t('account.twoFactor.copied') : t('account.twoFactor.copy') }}
        </Button>
      </div>
    </AlertDescription>
  </Alert>
</template>
