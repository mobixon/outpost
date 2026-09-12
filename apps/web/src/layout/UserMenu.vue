<script setup lang="ts">
import { CircleUserIcon, LogOutIcon, UserIcon } from '@lucide/vue';
import { API_PREFIX } from '@outpost/shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@outpost/ui';
import { apiSend } from '@outpost/web-plugin-api';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';

defineProps<{ username: string }>();

const { t } = useI18n();

async function signOut(): Promise<void> {
  try {
    await apiSend('POST', `${API_PREFIX}/auth/logout`);
  } finally {
    window.location.assign('/login');
  }
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="sm" :aria-label="t('nav.userMenu', { username })">
        <CircleUserIcon />
        <span class="hidden sm:inline">{{ username }}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-48">
      <DropdownMenuLabel class="truncate">{{ username }}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem as-child>
        <RouterLink to="/account">
          <UserIcon />
          {{ t('nav.account') }}
        </RouterLink>
      </DropdownMenuItem>
      <DropdownMenuItem @select="signOut">
        <LogOutIcon />
        {{ t('nav.signOut') }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
