<script setup lang="ts">
import { Spinner } from '@outpost/ui';
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { returnTarget, takeStoredReturn } from '../external-auth.js';
import { flash } from '../flash.js';

// A login provider sent the browser back here (see startExternalAuth): continue on the right page
// and tell the user how it went.
const { t, te } = useI18n();
const route = useRoute();
const router = useRouter();

const queryValue = (name: string) => {
  const value = route.query[name];
  return typeof value === 'string' ? value : undefined;
};

onMounted(() => {
  const intent = queryValue('intent');
  const error = queryValue('error');
  const target = returnTarget(intent, error !== undefined, takeStoredReturn());
  const path = new URL(target, window.location.origin).pathname;
  if (error !== undefined) {
    const key = `errors.${error}`;
    flash.value = { kind: 'error', message: te(key) ? t(key) : t('errors.generic'), path };
  } else if (intent === 'link') {
    flash.value = { kind: 'success', message: t('account.identities.linked'), path };
  } else if (intent === 'sudo') {
    flash.value = { kind: 'success', message: t('account.sudo.confirmed'), path };
  }
  void router.replace(target);
});
</script>

<template>
  <main class="flex min-h-full items-center justify-center">
    <Spinner class="size-6" :aria-label="t('authReturn.working')" />
  </main>
</template>
