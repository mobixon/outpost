<script setup lang="ts">
import { API_PREFIX, GAME_IDS, serverSummarySchema } from '@outpost/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@outpost/ui';
import { apiSend } from '@outpost/web-plugin-api';
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useErrorMessage } from '../errors.js';
import { loadServers, slugFromName } from '../servers.js';

const open = defineModel<boolean>('open', { required: true });

const { t } = useI18n();
const errorMessage = useErrorMessage();
const router = useRouter();
const blank = () => ({ name: '', slug: '', game: GAME_IDS[0] as string });
const form = reactive(blank());
// The short name follows the name until the user edits it.
const slugEdited = ref(false);
const error = ref<string>();
const busy = ref(false);

watch(
  () => form.name,
  (name) => {
    if (!slugEdited.value) form.slug = slugFromName(name);
  },
);
watch(open, (value) => {
  if (value) {
    Object.assign(form, blank());
    slugEdited.value = false;
    error.value = undefined;
  }
});

async function submit(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = undefined;
  try {
    const server = await apiSend(
      'POST',
      `${API_PREFIX}/servers`,
      { name: form.name, slug: form.slug, game: form.game },
      serverSummarySchema,
    );
    await loadServers();
    open.value = false;
    await router.push(`/servers/${server.slug}`);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <DialogHeader>
          <DialogTitle>{{ t('servers.add.title') }}</DialogTitle>
          <DialogDescription>{{ t('servers.add.text') }}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel for="server-game">{{ t('servers.add.game') }}</FieldLabel>
            <Select v-model="form.game">
              <SelectTrigger id="server-game" class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="game in GAME_IDS" :key="game" :value="game">
                  {{ t(`games.${game}`) }}
                </SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>{{ t('servers.add.gameHint') }}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel for="server-name">{{ t('servers.add.name') }}</FieldLabel>
            <Input id="server-name" v-model="form.name" maxlength="64" required />
          </Field>
          <Field>
            <FieldLabel for="server-slug">{{ t('servers.add.slug') }}</FieldLabel>
            <Input
              id="server-slug"
              v-model="form.slug"
              class="font-mono"
              maxlength="32"
              required
              @input="slugEdited = true"
            />
            <FieldDescription>{{ t('servers.add.slugHint') }}</FieldDescription>
          </Field>
        </FieldGroup>
        <Alert v-if="error" variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
        <DialogFooter>
          <Button type="submit" :disabled="busy">
            <Spinner v-if="busy" />
            {{ t('servers.add.submit') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
