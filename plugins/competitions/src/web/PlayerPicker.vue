<script setup lang="ts">
import { XIcon } from '@lucide/vue';
import { Badge, Button, Input } from '@outpost/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CandidateList, PlayerRef } from '../shared.js';

/** Most matches shown at once. */
const SHOWN = 8;

const props = defineProps<{
  id: string;
  candidates: CandidateList['players'];
}>();
const selected = defineModel<PlayerRef[]>({ required: true });

const { t } = useI18n();
const query = ref('');

const matches = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (needle === '') return [];
  const taken = new Set(selected.value.map(({ uuid }) => uuid));
  return props.candidates
    .filter(({ uuid, name }) => !taken.has(uuid) && name.toLowerCase().includes(needle))
    .slice(0, SHOWN);
});

function add(player: PlayerRef): void {
  selected.value = [...selected.value, { uuid: player.uuid, name: player.name }];
  query.value = '';
}

function remove(uuid: string): void {
  selected.value = selected.value.filter((player) => player.uuid !== uuid);
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <ul v-if="selected.length > 0" class="flex flex-wrap gap-1.5">
      <li v-for="player in selected" :key="player.uuid">
        <Badge variant="secondary" class="gap-1 pr-1">
          {{ player.name }}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="size-5"
            :aria-label="t('competitions.form.remove', { name: player.name })"
            @click="remove(player.uuid)"
          >
            <XIcon class="size-3" />
          </Button>
        </Badge>
      </li>
    </ul>
    <Input
      :id="id"
      v-model="query"
      autocomplete="off"
      spellcheck="false"
      :placeholder="t('competitions.form.search')"
    />
    <ul v-if="matches.length > 0" class="flex flex-wrap gap-1.5">
      <li v-for="player in matches" :key="player.uuid">
        <Button type="button" variant="outline" size="sm" @click="add(player)">
          {{ player.name }}
          <span v-if="player.operator" class="text-muted-foreground text-xs">op</span>
        </Button>
      </li>
    </ul>
    <p v-else-if="query.trim() !== ''" class="text-muted-foreground text-xs">
      {{ t('competitions.form.noPlayers') }}
    </p>
  </div>
</template>
