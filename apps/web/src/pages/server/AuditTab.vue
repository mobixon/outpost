<script setup lang="ts">
import { useServerContext } from '@outpost/web-plugin-api';
import AuditLogView from '../../audit/AuditLogView.vue';

const { server } = useServerContext();
</script>

<template>
  <AuditLogView :server-id="server.id" />
</template>
