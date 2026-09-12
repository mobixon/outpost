<script setup lang="ts">
import { PlugZapIcon } from '@lucide/vue';
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle } from '@outpost/ui';
import { useServerContext } from '@outpost/web-plugin-api';
import { useI18n } from 'vue-i18n';

const { t, te } = useI18n();
const { server } = useServerContext();

/** A permission in words when the core or the module translates it, else its key. */
const describe = (permission: string) =>
  te(`permissions.${permission}`) ? t(`permissions.${permission}`) : permission;
</script>

<template>
  <div class="flex flex-col gap-6">
    <Card>
      <CardHeader>
        <CardTitle>{{ t('servers.overview.connection') }}</CardTitle>
      </CardHeader>
      <CardContent>
        <Alert v-if="!server.connected">
          <PlugZapIcon />
          <AlertDescription>{{ t('servers.overview.notConnected') }}</AlertDescription>
        </Alert>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>{{ t('servers.overview.access') }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-3 text-sm">
        <p>
          <span class="text-muted-foreground">{{ t('account.role') }}:</span>
          {{ server.role ? t(`roles.${server.role}`) : t('account.superadmin') }}
        </p>
        <div>
          <p class="text-muted-foreground mb-1">{{ t('servers.overview.youCan') }}</p>
          <ul class="list-disc pl-5">
            <li v-for="permission in server.permissions" :key="permission">
              {{ describe(permission) }}
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
