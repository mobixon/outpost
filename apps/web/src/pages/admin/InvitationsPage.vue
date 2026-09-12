<script setup lang="ts">
import { Trash2Icon } from '@lucide/vue';
import {
  API_PREFIX,
  INVITATION_LIFETIMES_DAYS,
  invitationCreatedSchema,
  invitationListSchema,
  ROLE_KEYS,
  type InvitationInfo,
} from '@outpost/shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@outpost/ui';
import { apiFetch, apiSend } from '@outpost/web-plugin-api';
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { SudoCancelled, withSudo } from '../../account/sudo.js';
import { useErrorMessage } from '../../errors.js';
import InvitationLink from '../../invitations/InvitationLink.vue';
import { loadServers, servers } from '../../servers.js';

const NO_SERVER = 'none';
const { t, locale } = useI18n();
const errorMessage = useErrorMessage();
const invitations = ref<InvitationInfo[]>([]);
const form = reactive({
  account: 'user',
  days: '7',
  note: '',
  server: NO_SERVER,
  serverRole: 'viewer',
});
const link = ref<string | null>(null);
const error = ref<string>();
const busy = ref(false);

async function load(): Promise<void> {
  invitations.value = (
    await apiFetch(`${API_PREFIX}/invitations`, invitationListSchema)
  ).invitations;
}

async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  error.value = undefined;
  busy.value = true;
  try {
    await action();
    await load();
  } catch (err) {
    if (!(err instanceof SudoCancelled)) error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

const create = () =>
  run(async () => {
    const created = await withSudo(() =>
      apiSend(
        'POST',
        `${API_PREFIX}/invitations`,
        {
          isSuperadmin: form.account === 'superadmin',
          expiresInDays: Number(form.days),
          ...(form.note.trim() !== '' && { note: form.note.trim() }),
          ...(form.server !== NO_SERVER && { serverId: form.server, role: form.serverRole }),
        },
        invitationCreatedSchema,
      ),
    );
    link.value = created.url;
    form.note = '';
  });

const remove = (invitation: InvitationInfo) =>
  run(() => apiSend('DELETE', `${API_PREFIX}/invitations/${encodeURIComponent(invitation.id)}`));

const statusVariant = (status: InvitationInfo['status']) =>
  status === 'pending' ? 'default' : status === 'used' ? 'secondary' : 'outline';
const formatTime = (iso: string) =>
  new Date(iso).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' });

onMounted(() => {
  Promise.all([load(), loadServers()]).catch((err: unknown) => {
    error.value = errorMessage(err);
  });
});
</script>

<template>
  <section class="mx-auto flex max-w-5xl flex-col gap-6">
    <h1 class="text-2xl font-semibold tracking-tight">{{ t('admin.invitations.title') }}</h1>

    <Card>
      <CardHeader>
        <CardTitle>{{ t('admin.invitations.newTitle') }}</CardTitle>
        <CardDescription>{{ t('admin.invitations.newText') }}</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <form class="flex flex-col gap-4" @submit.prevent="create">
          <FieldGroup class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field>
              <FieldLabel for="invitation-account">{{ t('admin.invitations.account') }}</FieldLabel>
              <Select v-model="form.account">
                <SelectTrigger id="invitation-account" class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">{{ t('account.user') }}</SelectItem>
                  <SelectItem value="superadmin">{{ t('account.superadmin') }}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel for="invitation-server">{{ t('admin.invitations.server') }}</FieldLabel>
              <Select v-model="form.server">
                <SelectTrigger id="invitation-server" class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="NO_SERVER">{{ t('admin.invitations.noServer') }}</SelectItem>
                  <SelectItem v-for="server in servers ?? []" :key="server.id" :value="server.id">
                    {{ server.name }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel for="invitation-server-role">{{
                t('admin.invitations.serverRole')
              }}</FieldLabel>
              <Select v-model="form.serverRole" :disabled="form.server === NO_SERVER">
                <SelectTrigger id="invitation-server-role" class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="role in ROLE_KEYS" :key="role" :value="role">
                    {{ t(`roles.${role}`) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel for="invitation-days">{{ t('admin.invitations.validFor') }}</FieldLabel>
              <Select v-model="form.days">
                <SelectTrigger id="invitation-days" class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="days in INVITATION_LIFETIMES_DAYS"
                    :key="days"
                    :value="String(days)"
                  >
                    {{ t(`admin.invitations.days${days}`) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field class="lg:col-span-2">
              <FieldLabel for="invitation-note">{{ t('admin.invitations.note') }}</FieldLabel>
              <Input
                id="invitation-note"
                v-model="form.note"
                maxlength="100"
                :placeholder="t('admin.invitations.notePlaceholder')"
              />
            </Field>
          </FieldGroup>
          <Button type="submit" class="self-start" :disabled="busy">
            <Spinner v-if="busy" />
            {{ t('admin.invitations.create') }}
          </Button>
        </form>

        <InvitationLink v-if="link" :link="link" />
      </CardContent>
    </Card>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <Card>
      <CardHeader>
        <CardTitle>{{ t('admin.invitations.listTitle') }}</CardTitle>
      </CardHeader>
      <CardContent>
        <p v-if="invitations.length === 0" class="text-muted-foreground text-sm">
          {{ t('admin.invitations.empty') }}
        </p>
        <Table v-else>
          <TableHeader>
            <TableRow>
              <TableHead>{{ t('admin.invitations.note') }}</TableHead>
              <TableHead>{{ t('admin.invitations.account') }}</TableHead>
              <TableHead>{{ t('admin.invitations.server') }}</TableHead>
              <TableHead>{{ t('admin.invitations.status') }}</TableHead>
              <TableHead>{{ t('admin.invitations.created2') }}</TableHead>
              <TableHead>{{ t('admin.invitations.expires') }}</TableHead>
              <TableHead class="w-12">
                <span class="sr-only">{{ t('admin.actions') }}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="invitation in invitations" :key="invitation.id">
              <TableCell>{{ invitation.note ?? '—' }}</TableCell>
              <TableCell>{{
                invitation.isSuperadmin ? t('account.superadmin') : t('account.user')
              }}</TableCell>
              <TableCell>
                <template v-if="invitation.serverName && invitation.role">
                  {{ invitation.serverName }} · {{ t(`roles.${invitation.role}`) }}
                </template>
                <template v-else>—</template>
              </TableCell>
              <TableCell>
                <div class="flex flex-col items-start gap-1">
                  <Badge :variant="statusVariant(invitation.status)">
                    {{ t(`admin.invitations.statuses.${invitation.status}`) }}
                  </Badge>
                  <span v-if="invitation.usedBy" class="text-muted-foreground text-xs">
                    {{ invitation.usedBy }}
                  </span>
                </div>
              </TableCell>
              <TableCell class="text-muted-foreground">
                {{ invitation.createdBy ?? '—' }}, {{ formatTime(invitation.createdAt) }}
              </TableCell>
              <TableCell class="text-muted-foreground">{{
                formatTime(invitation.expiresAt)
              }}</TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  :disabled="busy"
                  :aria-label="t('admin.invitations.delete')"
                  :title="t('admin.invitations.delete')"
                  @click="remove(invitation)"
                >
                  <Trash2Icon />
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </section>
</template>
