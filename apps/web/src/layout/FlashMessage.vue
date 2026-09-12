<script setup lang="ts">
import { CircleAlertIcon, CircleCheckIcon } from '@lucide/vue';
import { Alert, AlertDescription } from '@outpost/ui';
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { flash } from '../flash.js';

const route = useRoute();
const current = computed(() => (flash.value?.path === route.path ? flash.value : null));
</script>

<template>
  <Alert
    v-if="current"
    :variant="current.kind === 'error' ? 'destructive' : 'default'"
    role="status"
    data-testid="flash-message"
  >
    <CircleAlertIcon v-if="current.kind === 'error'" />
    <CircleCheckIcon v-else />
    <AlertDescription>{{ current.message }}</AlertDescription>
  </Alert>
</template>
