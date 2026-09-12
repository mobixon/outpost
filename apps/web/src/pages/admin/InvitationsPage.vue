<script setup lang="ts">
import { CheckIcon, CopyIcon, Trash2Icon } from '@lucide/vue';
import {
  API_PREFIX,
  INVITATION_LIFETIMES_DAYS,
  invitationCreatedSchema,
  invitationListSchema,
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

const { t, locale } = useI18n();
const errorMessage = useErrorMessage();
const invitations = ref<InvitationInfo[]>([]);
const form = reactive({ role: 'user', days: '7', note: '' });
const link = ref<string | null>(null);
const copied = ref(false);
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
          isSuperadmin: form.role === 'superadmin',
          expiresInDays: Number(form.days),
          ...(form.note.trim() !== '' && { note: form.note.trim() }),
        },
        invitationCreatedSchema,
      ),
    );
    link.value = created.url;
    copied.value = false;
    form.note = '';
  });

const remove = (invitation: InvitationInfo) =>
  run(() => apiSend('DELETE', `${API_PREFIX}/invitations/${encodeURIComponent(invitation.id)}`));

async function copy(): Promise<void> {
  if (link.value === null) return;
  try {
    await navigator.clipboard.writeText(link.value);
    copied.value = true;
  } catch {
    // The clipboard needs HTTPS; the link stays visible for copying by hand.
  }
}

const statusVariant = (status: InvitationInfo['status']) =>
  status === 'pending' ? 'default' : status === 'used' ? 'secondary' : 'outline';
const formatTime = (iso: string) =>
  new Date(iso).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' });

onMounted(() => {
  load().catch((err: unknown) => {
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
          <FieldGroup class="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel for="invitation-role">{{ t('account.role') }}</FieldLabel>
              <Select v-model="form.role">
                <SelectTrigger id="invitation-role" class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">{{ t('account.user') }}</SelectItem>
                  <SelectItem value="superadmin">{{ t('account.superadmin') }}</SelectItem>
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
            <Field>
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

        <Alert v-if="link" data-testid="invitation-created">
          <AlertDescription class="flex flex-col gap-3">
            <span>{{ t('admin.invitations.created') }}</span>
            <div class="flex gap-2">
              <Input
                :model-value="link"
                readonly
                class="font-mono"
                data-testid="invitation-link"
                :aria-label="t('admin.invitations.link')"
                @focus="($event.target as HTMLInputElement).select()"
              />
              <Button variant="outline" @click="copy">
                <CheckIcon v-if="copied" />
                <CopyIcon v-else />
                {{ copied ? t('account.twoFactor.copied') : t('account.twoFactor.copy') }}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
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
              <TableHead>{{ t('account.role') }}</TableHead>
              <TableHead>{{ t('admin.invitations.status') }}</TableHead>
              <TableHead>{{ t('admin.invitations.created2') }}</TableHead>
              <TableHead>{{ t('admin.invitations.expires') }}</TableHead>
              <TableHead class="w-12"
                ><span class="sr-only">{{ t('admin.actions') }}</span></TableHead
              >
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="invitation in invitations" :key="invitation.id">
              <TableCell>{{ invitation.note ?? '—' }}</TableCell>
              <TableCell>{{
                invitation.isSuperadmin ? t('account.superadmin') : t('account.user')
              }}</TableCell>
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
