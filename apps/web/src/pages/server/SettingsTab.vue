<script setup lang="ts">
import { API_PREFIX } from '@outpost/shared';
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
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Spinner,
} from '@outpost/ui';
import { apiSend, useServerContext } from '@outpost/web-plugin-api';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { SudoCancelled, withSudo } from '../../account/sudo.js';
import { useErrorMessage } from '../../errors.js';
import { loadServers } from '../../servers.js';
import { useShell } from '../../shell.js';
import ConnectionCard from './ConnectionCard.vue';
import FilesCard from './FilesCard.vue';

const { t, te } = useI18n();
const isSuperadmin = useShell().session?.user?.isSuperadmin === true;
const errorMessage = useErrorMessage();
const router = useRouter();
const { server, reload } = useServerContext();
const form = reactive({ name: server.value.name, slug: server.value.slug });
const saved = ref(false);
const confirming = ref(false);
const error = ref<string>();
const busy = ref(false);

const path = computed(() => `${API_PREFIX}/servers/${encodeURIComponent(server.value.id)}`);

async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  error.value = undefined;
  saved.value = false;
  busy.value = true;
  try {
    await action();
  } catch (err) {
    if (!(err instanceof SudoCancelled)) error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

const save = () =>
  run(async () => {
    await apiSend('PATCH', path.value, { name: form.name, slug: form.slug });
    if (form.slug !== server.value.slug) {
      // The page address contains the short name: open the new address.
      await loadServers();
      await router.replace(`/servers/${form.slug}/settings`);
    } else {
      await reload();
    }
    saved.value = true;
  });

const remove = () =>
  run(async () => {
    confirming.value = false;
    await withSudo(() => apiSend('DELETE', path.value));
    await loadServers();
    await router.push('/');
  });
</script>

<template>
  <div class="flex flex-col gap-6">
    <ConnectionCard v-if="isSuperadmin" />
    <FilesCard v-if="isSuperadmin" />
    <Card>
      <CardHeader>
        <CardTitle>{{ t('servers.settings.title') }}</CardTitle>
      </CardHeader>
      <CardContent>
        <form class="flex max-w-md flex-col gap-4" @submit.prevent="save">
          <FieldGroup>
            <Field>
              <FieldLabel>{{ t('servers.add.game') }}</FieldLabel>
              <p class="text-sm" data-testid="server-game">
                {{ te(`games.${server.game}`) ? t(`games.${server.game}`) : server.game }}
              </p>
              <FieldDescription>{{ t('servers.add.gameFixed') }}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel for="settings-name">{{ t('servers.add.name') }}</FieldLabel>
              <Input id="settings-name" v-model="form.name" maxlength="64" required />
            </Field>
            <Field>
              <FieldLabel for="settings-slug">{{ t('servers.add.slug') }}</FieldLabel>
              <Input
                id="settings-slug"
                v-model="form.slug"
                class="font-mono"
                maxlength="32"
                required
              />
              <FieldDescription>{{ t('servers.add.slugHint') }}</FieldDescription>
            </Field>
          </FieldGroup>
          <Alert v-if="saved">
            <AlertDescription>{{ t('servers.settings.saved') }}</AlertDescription>
          </Alert>
          <Button type="submit" class="self-start" :disabled="busy">
            <Spinner v-if="busy" />
            {{ t('servers.settings.save') }}
          </Button>
        </form>
      </CardContent>
    </Card>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <Card class="ring-destructive/30">
      <CardHeader>
        <CardTitle>{{ t('servers.settings.dangerTitle') }}</CardTitle>
        <CardDescription>{{ t('servers.settings.dangerText') }}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" :disabled="busy" @click="confirming = true">
          {{ t('servers.settings.delete') }}
        </Button>
      </CardContent>
    </Card>

    <AlertDialog v-model:open="confirming">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{
            t('servers.settings.deleteTitle', { name: server.name })
          }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('servers.settings.dangerText') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('admin.cancel') }}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" @click="remove">
            {{ t('servers.settings.delete') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
