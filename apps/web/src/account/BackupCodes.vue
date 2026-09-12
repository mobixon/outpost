<script setup lang="ts">
import { CheckIcon, CopyIcon } from '@lucide/vue';
import { Button } from '@outpost/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ codes: readonly string[] }>();
defineEmits<{ done: [] }>();

const { t } = useI18n();
const copied = ref(false);

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.codes.join('\n'));
    copied.value = true;
  } catch {
    // The clipboard needs HTTPS; the codes stay visible for copying by hand.
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <h3 class="font-medium">{{ t('account.twoFactor.backupCodesTitle') }}</h3>
    <p class="text-muted-foreground text-sm">{{ t('account.twoFactor.backupCodesText') }}</p>
    <ul
      class="bg-muted grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg p-4 font-mono text-sm"
      data-testid="backup-codes"
    >
      <li v-for="code in codes" :key="code">{{ code }}</li>
    </ul>
    <div class="flex flex-wrap gap-2">
      <Button variant="outline" @click="copy">
        <CheckIcon v-if="copied" />
        <CopyIcon v-else />
        {{ copied ? t('account.twoFactor.copied') : t('account.twoFactor.copy') }}
      </Button>
      <Button @click="$emit('done')">{{ t('account.twoFactor.done') }}</Button>
    </div>
  </div>
</template>
