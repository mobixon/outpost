<script setup lang="ts">
import { API_PREFIX, auditPageSchema, type AuditEntry } from '@outpost/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Field,
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
import { apiFetch } from '@outpost/web-plugin-api';
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useErrorMessage } from '../errors.js';
import { servers } from '../servers.js';

// The audit log of one server, or of the whole instance with a server filter (superadmins).
const props = defineProps<{ serverId?: string }>();

const ALL_SERVERS = 'all';
const { t, locale } = useI18n();
const errorMessage = useErrorMessage();
const filters = reactive({ action: '', username: '', server: ALL_SERVERS });
const entries = ref<AuditEntry[]>([]);
const nextCursor = ref<string | null>(null);
const error = ref<string>();
const loading = ref(false);

async function load(more: boolean): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  error.value = undefined;
  try {
    const query = new URLSearchParams({ limit: '50' });
    if (filters.action.trim() !== '') query.set('action', filters.action.trim());
    if (filters.username.trim() !== '') query.set('username', filters.username.trim());
    if (props.serverId === undefined && filters.server !== ALL_SERVERS) {
      query.set('serverId', filters.server);
    }
    if (more && nextCursor.value !== null) query.set('cursor', nextCursor.value);
    const url =
      props.serverId === undefined
        ? `${API_PREFIX}/audit?${query}`
        : `${API_PREFIX}/servers/${encodeURIComponent(props.serverId)}/audit?${query}`;
    const page = await apiFetch(url, auditPageSchema);
    entries.value = more ? [...entries.value, ...page.entries] : page.entries;
    nextCursor.value = page.nextCursor;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

/** Target and details in one short line. */
function describe(entry: AuditEntry): string {
  const details = entry.details === null ? '' : JSON.stringify(entry.details);
  return [entry.target, details].filter((part) => part !== null && part !== '').join(' ');
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'medium' });

onMounted(() => load(false));
</script>

<template>
  <div class="flex flex-col gap-4">
    <form
      class="flex flex-wrap items-end gap-3"
      data-testid="audit-filters"
      @submit.prevent="load(false)"
    >
      <Field class="w-56">
        <FieldLabel for="audit-action">{{ t('audit.filterAction') }}</FieldLabel>
        <Input id="audit-action" v-model="filters.action" placeholder="server." />
      </Field>
      <Field class="w-44">
        <FieldLabel for="audit-user">{{ t('auth.username') }}</FieldLabel>
        <Input id="audit-user" v-model="filters.username" autocomplete="off" />
      </Field>
      <Field v-if="serverId === undefined" class="w-52">
        <FieldLabel for="audit-server">{{ t('audit.server') }}</FieldLabel>
        <Select v-model="filters.server">
          <SelectTrigger id="audit-server" class="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem :value="ALL_SERVERS">{{ t('audit.allServers') }}</SelectItem>
            <SelectItem v-for="server in servers ?? []" :key="server.id" :value="server.id">
              {{ server.name }}
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Button type="submit" variant="outline" :disabled="loading">{{ t('audit.apply') }}</Button>
    </form>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <Card>
      <CardContent>
        <p v-if="entries.length === 0 && !loading" class="text-muted-foreground text-sm">
          {{ t('audit.empty') }}
        </p>
        <Table v-else>
          <TableHeader>
            <TableRow>
              <TableHead>{{ t('audit.time') }}</TableHead>
              <TableHead>{{ t('audit.user') }}</TableHead>
              <TableHead v-if="serverId === undefined">{{ t('audit.server') }}</TableHead>
              <TableHead>{{ t('audit.action') }}</TableHead>
              <TableHead>{{ t('audit.details') }}</TableHead>
              <TableHead>{{ t('audit.ip') }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="entry in entries" :key="entry.id">
              <TableCell class="text-muted-foreground whitespace-nowrap">{{
                formatTime(entry.at)
              }}</TableCell>
              <TableCell class="font-mono">
                {{
                  entry.username ??
                  (entry.userId === null ? t('audit.system') : t('audit.deletedUser'))
                }}
              </TableCell>
              <TableCell v-if="serverId === undefined">
                {{ entry.serverName ?? (entry.serverId === null ? '—' : t('audit.deletedServer')) }}
              </TableCell>
              <TableCell class="font-mono text-xs">{{ entry.action }}</TableCell>
              <TableCell
                class="text-muted-foreground max-w-80 truncate font-mono text-xs"
                :title="describe(entry)"
              >
                {{ describe(entry) }}
              </TableCell>
              <TableCell class="text-muted-foreground font-mono text-xs">{{
                entry.ip ?? ''
              }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <div v-if="loading" class="flex justify-center py-4"><Spinner /></div>
      </CardContent>
    </Card>

    <Button
      v-if="nextCursor !== null"
      variant="outline"
      class="self-center"
      :disabled="loading"
      @click="load(true)"
    >
      {{ t('audit.more') }}
    </Button>
  </div>
</template>
