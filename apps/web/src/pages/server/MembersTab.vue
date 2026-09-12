<script setup lang="ts">
import { Trash2Icon, UserPlusIcon } from '@lucide/vue';
import {
  API_PREFIX,
  INVITATION_LIFETIMES_DAYS,
  invitationCreatedSchema,
  invitationListSchema,
  memberListSchema,
  type InvitationInfo,
  type Member,
  type RoleKey,
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
import { apiFetch, apiSend, useServerContext } from '@outpost/web-plugin-api';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { SudoCancelled, withSudo } from '../../account/sudo.js';
import { useErrorMessage } from '../../errors.js';
import InvitationLink from '../../invitations/InvitationLink.vue';
import { useShell } from '../../shell.js';

const { t, locale } = useI18n();
const errorMessage = useErrorMessage();
const shell = useShell();
const { server } = useServerContext();
const selfId = shell.session?.user?.id;
const members = ref<Member[]>([]);
const assignable = ref<RoleKey[]>([]);
const invitations = ref<InvitationInfo[]>([]);
const addForm = reactive({ username: '', role: 'viewer' });
const inviteForm = reactive({ role: 'viewer', days: '7', note: '' });
const link = ref<string | null>(null);
const error = ref<string>();
const busy = ref(false);

const base = computed(() => `${API_PREFIX}/servers/${encodeURIComponent(server.value.id)}`);

async function load(): Promise<void> {
  const [list, pending] = await Promise.all([
    apiFetch(`${base.value}/members`, memberListSchema),
    apiFetch(`${base.value}/invitations`, invitationListSchema),
  ]);
  members.value = list.members;
  assignable.value = list.assignableRoles;
  invitations.value = pending.invitations;
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

const memberPath = (member: Member) => `${base.value}/members/${encodeURIComponent(member.userId)}`;

const add = () =>
  run(async () => {
    await apiSend('POST', `${base.value}/members`, {
      username: addForm.username,
      role: addForm.role,
    });
    addForm.username = '';
  });

const changeRole = (member: Member, role: unknown) => {
  if (typeof role !== 'string' || role === member.role) return;
  void run(() => apiSend('PATCH', memberPath(member), { role }));
};

const remove = (member: Member) => run(() => apiSend('DELETE', memberPath(member)));

const invite = () =>
  run(async () => {
    const created = await apiSend(
      'POST',
      `${base.value}/invitations`,
      {
        role: inviteForm.role,
        expiresInDays: Number(inviteForm.days),
        ...(inviteForm.note.trim() !== '' && { note: inviteForm.note.trim() }),
      },
      invitationCreatedSchema,
    );
    link.value = created.url;
    inviteForm.note = '';
  });

const withdraw = (invitation: InvitationInfo) =>
  run(() => apiSend('DELETE', `${base.value}/invitations/${encodeURIComponent(invitation.id)}`));

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(locale.value, { dateStyle: 'medium' });

onMounted(() => {
  load().catch((err: unknown) => {
    error.value = errorMessage(err);
  });
});
</script>

<template>
  <div class="flex flex-col gap-6">
    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <Card>
      <CardHeader>
        <CardTitle>{{ t('servers.members.title') }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-6">
        <p v-if="members.length === 0" class="text-muted-foreground text-sm">
          {{ t('servers.members.empty') }}
        </p>
        <Table v-else>
          <TableHeader>
            <TableRow>
              <TableHead>{{ t('auth.username') }}</TableHead>
              <TableHead>{{ t('account.role') }}</TableHead>
              <TableHead>{{ t('servers.members.added') }}</TableHead>
              <TableHead class="w-12">
                <span class="sr-only">{{ t('admin.actions') }}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="member in members"
              :key="member.userId"
              :data-testid="`member-${member.username}`"
            >
              <TableCell>
                <span class="font-mono">{{ member.username }}</span>
                <Badge v-if="member.userId === selfId" variant="secondary" class="ml-2">
                  {{ t('admin.users.you') }}
                </Badge>
              </TableCell>
              <TableCell>
                <Select
                  v-if="member.manageable"
                  :model-value="member.role"
                  :disabled="busy"
                  @update:model-value="changeRole(member, $event)"
                >
                  <SelectTrigger
                    size="sm"
                    class="w-40"
                    :aria-label="t('servers.members.changeRole', { username: member.username })"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="role in assignable" :key="role" :value="role">
                      {{ t(`roles.${role}`) }}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <span v-else>{{ t(`roles.${member.role}`) }}</span>
              </TableCell>
              <TableCell class="text-muted-foreground">{{
                formatDate(member.createdAt)
              }}</TableCell>
              <TableCell>
                <Button
                  v-if="member.manageable"
                  variant="ghost"
                  size="icon"
                  :disabled="busy"
                  :aria-label="t('servers.members.remove', { username: member.username })"
                  :title="t('servers.members.remove', { username: member.username })"
                  @click="remove(member)"
                >
                  <Trash2Icon />
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <form class="flex flex-col gap-3" @submit.prevent="add">
          <h3 class="font-medium">{{ t('servers.members.add') }}</h3>
          <p class="text-muted-foreground text-sm">{{ t('servers.members.addText') }}</p>
          <FieldGroup class="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
            <Field>
              <FieldLabel for="member-username">{{ t('auth.username') }}</FieldLabel>
              <Input id="member-username" v-model="addForm.username" autocomplete="off" required />
            </Field>
            <Field>
              <FieldLabel for="member-role">{{ t('account.role') }}</FieldLabel>
              <Select v-model="addForm.role">
                <SelectTrigger id="member-role" class="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="role in assignable" :key="role" :value="role">
                    {{ t(`roles.${role}`) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Button type="submit" :disabled="busy">
              <UserPlusIcon />
              {{ t('servers.members.addSubmit') }}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>{{ t('servers.members.inviteTitle') }}</CardTitle>
        <CardDescription>{{ t('servers.members.inviteText') }}</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <form class="flex flex-col gap-4" @submit.prevent="invite">
          <FieldGroup class="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel for="invite-role">{{ t('account.role') }}</FieldLabel>
              <Select v-model="inviteForm.role">
                <SelectTrigger id="invite-role" class="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="role in assignable" :key="role" :value="role">
                    {{ t(`roles.${role}`) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel for="invite-days">{{ t('admin.invitations.validFor') }}</FieldLabel>
              <Select v-model="inviteForm.days">
                <SelectTrigger id="invite-days" class="w-full"><SelectValue /></SelectTrigger>
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
            <Field>
              <FieldLabel for="invite-note">{{ t('admin.invitations.note') }}</FieldLabel>
              <Input
                id="invite-note"
                v-model="inviteForm.note"
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

        <Table v-if="invitations.length > 0">
          <TableHeader>
            <TableRow>
              <TableHead>{{ t('admin.invitations.note') }}</TableHead>
              <TableHead>{{ t('account.role') }}</TableHead>
              <TableHead>{{ t('admin.invitations.status') }}</TableHead>
              <TableHead>{{ t('admin.invitations.expires') }}</TableHead>
              <TableHead class="w-12">
                <span class="sr-only">{{ t('admin.actions') }}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="invitation in invitations" :key="invitation.id">
              <TableCell>{{ invitation.note ?? '—' }}</TableCell>
              <TableCell>{{ invitation.role ? t(`roles.${invitation.role}`) : '—' }}</TableCell>
              <TableCell>
                <Badge :variant="invitation.status === 'pending' ? 'default' : 'secondary'">
                  {{ t(`admin.invitations.statuses.${invitation.status}`) }}
                </Badge>
                <span v-if="invitation.usedBy" class="text-muted-foreground ml-2 text-xs">
                  {{ invitation.usedBy }}
                </span>
              </TableCell>
              <TableCell class="text-muted-foreground">{{
                formatDate(invitation.expiresAt)
              }}</TableCell>
              <TableCell>
                <Button
                  v-if="invitation.role === null || assignable.includes(invitation.role)"
                  variant="ghost"
                  size="icon"
                  :disabled="busy"
                  :aria-label="t('admin.invitations.delete')"
                  :title="t('admin.invitations.delete')"
                  @click="withdraw(invitation)"
                >
                  <Trash2Icon />
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>
