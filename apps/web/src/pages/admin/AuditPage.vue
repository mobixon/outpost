<script setup lang="ts">
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import AuditLogView from '../../audit/AuditLogView.vue';
import { loadServers } from '../../servers.js';

const { t } = useI18n();

// For the server filter.
onMounted(() => {
  loadServers().catch(() => undefined);
});
</script>

<template>
  <section class="mx-auto flex max-w-6xl flex-col gap-6">
    <h1 class="text-2xl font-semibold tracking-tight">{{ t('audit.title') }}</h1>
    <AuditLogView />
  </section>
</template>
