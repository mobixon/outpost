<script setup lang="ts">
import { LogInIcon } from '@lucide/vue';
import type { ProviderInfo } from '@outpost/shared';
import { Button, Separator } from '@outpost/ui';
import { useI18n } from 'vue-i18n';

defineProps<{ providers: readonly ProviderInfo[]; disabled?: boolean }>();
const emit = defineEmits<{ select: [provider: string] }>();

const { t } = useI18n();
</script>

<template>
  <div v-if="providers.length > 0" class="flex flex-col gap-3">
    <div class="text-muted-foreground flex items-center gap-3 text-xs">
      <Separator class="flex-1" />
      <span>{{ t('auth.or') }}</span>
      <Separator class="flex-1" />
    </div>
    <Button
      v-for="provider in providers"
      :key="provider.id"
      type="button"
      variant="outline"
      :disabled="disabled"
      @click="emit('select', provider.id)"
    >
      <LogInIcon />
      {{ t('auth.continueWith', { provider: provider.name }) }}
    </Button>
  </div>
</template>
