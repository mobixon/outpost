<script setup lang="ts">
import { EllipsisIcon, MailPlusIcon } from '@lucide/vue';
import { API_PREFIX, adminUserListSchema, type AdminUser } from '@outpost/shared';
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@outpost/ui';
import { apiFetch, apiSend } from '@outpost/web-plugin-api';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { SudoCancelled, withSudo } from '../../account/sudo.js';
import { useErrorMessage } from '../../errors.js';
import { useShell } from '../../shell.js';

const { t, locale } = useI18n();
const errorMessage = useErrorMessage();
const shell = useShell();
const selfId = shell.session?.user?.id;
const users = ref<AdminUser[]>([]);
const error = ref<string>();
const busy = ref(false);
const pendingDelete = ref<AdminUser | null>(null);

async function load(): Promise<void> {
  users.value = (await apiFetch(`${API_PREFIX}/users`, adminUserListSchema)).users;
}

async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  error.value = undefined;
  busy.value = true;
  try {
    await withSudo(action);
    await load();
  } catch (err) {
    if (!(err instanceof SudoCancelled)) error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

const userPath = (user: AdminUser) => `${API_PREFIX}/users/${encodeURIComponent(user.id)}`;
const update = (user: AdminUser, changes: { disabled?: boolean; isSuperadmin?: boolean }) =>
  run(() => apiSend('PATCH', userPath(user), changes));
const resetTwoFactor = (user: AdminUser) =>
  run(() => apiSend('POST', `${userPath(user)}/2fa/reset`));

function confirmDelete(): void {
  const user = pendingDelete.value;
  pendingDelete.value = null;
  if (user !== null) void run(() => apiSend('DELETE', userPath(user)));
}

const providerName = (id: string) =>
  shell.session?.providers.find((provider) => provider.id === id)?.name ?? id;
const loginMethods = (user: AdminUser) =>
  [
    ...(user.hasPassword ? [t('admin.users.password')] : []),
    ...user.providers.map(providerName),
  ].join(', ');
const formatTime = (iso: string | null) =>
  iso === null
    ? t('admin.users.never')
    : new Date(iso).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' });

onMounted(() => {
  load().catch((err: unknown) => {
    error.value = errorMessage(err);
  });
});
</script>

<template>
  <section class="mx-auto flex max-w-5xl flex-col gap-6">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-2xl font-semibold tracking-tight">{{ t('admin.users.title') }}</h1>
      <Button as-child variant="outline">
        <RouterLink to="/admin/invitations">
          <MailPlusIcon />
          {{ t('admin.users.invite') }}
        </RouterLink>
      </Button>
    </div>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{{ t('admin.users.user') }}</TableHead>
              <TableHead>{{ t('admin.users.signIn') }}</TableHead>
              <TableHead>{{ t('admin.users.twoFactor') }}</TableHead>
              <TableHead>{{ t('admin.users.lastSeen') }}</TableHead>
              <TableHead class="w-12"
                ><span class="sr-only">{{ t('admin.actions') }}</span></TableHead
              >
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="user in users" :key="user.id" :data-testid="`user-${user.username}`">
              <TableCell>
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono">{{ user.username }}</span>
                  <Badge v-if="user.isSuperadmin">{{ t('account.superadmin') }}</Badge>
                  <Badge v-if="user.disabled" variant="destructive">
                    {{ t('admin.users.disabled') }}
                  </Badge>
                  <Badge v-if="user.id === selfId" variant="secondary">
                    {{ t('admin.users.you') }}
                  </Badge>
                </div>
              </TableCell>
              <TableCell>{{ loginMethods(user) }}</TableCell>
              <TableCell>
                <Badge :variant="user.twoFactorEnabled ? 'default' : 'secondary'">
                  {{
                    user.twoFactorEnabled ? t('account.twoFactor.on') : t('account.twoFactor.off')
                  }}
                </Badge>
              </TableCell>
              <TableCell class="text-muted-foreground">{{ formatTime(user.lastSeenAt) }}</TableCell>
              <TableCell>
                <DropdownMenu v-if="user.id !== selfId">
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      :disabled="busy"
                      :aria-label="t('admin.users.actions', { username: user.username })"
                    >
                      <EllipsisIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" class="w-64">
                    <DropdownMenuItem @select="update(user, { isSuperadmin: !user.isSuperadmin })">
                      {{
                        user.isSuperadmin
                          ? t('admin.users.removeAdmin')
                          : t('admin.users.makeAdmin')
                      }}
                    </DropdownMenuItem>
                    <DropdownMenuItem @select="update(user, { disabled: !user.disabled })">
                      {{ user.disabled ? t('admin.users.enable') : t('admin.users.disable') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem v-if="user.twoFactorEnabled" @select="resetTwoFactor(user)">
                      {{ t('admin.users.resetTwoFactor') }}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" @select="pendingDelete = user">
                      {{ t('admin.users.delete') }}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <AlertDialog
      :open="pendingDelete !== null"
      @update:open="
        (value: boolean) => {
          if (!value) pendingDelete = null;
        }
      "
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{
            t('admin.users.deleteTitle', { username: pendingDelete?.username ?? '' })
          }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('admin.users.deleteText') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('admin.cancel') }}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" @click="confirmDelete">
            {{ t('admin.users.delete') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>
