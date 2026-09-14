<script setup lang="ts">
import { computed } from 'vue';
import type { Icon, StoredItem } from '../shared.js';
import ItemIcon from './ItemIcon.vue';

const props = defineProps<{
  item: StoredItem | null;
  icons: Record<string, Icon>;
  textures: Record<string, string>;
  selected?: boolean;
  /** The selected hotbar slot. */
  highlight?: boolean;
}>();
const emit = defineEmits<{ select: [item: StoredItem] }>();

/** Durability left, 0–1; null for items that are not worn. */
const durability = computed(() => {
  const item = props.item;
  if (!item || item.damage === null || !item.maxDamage || item.damage <= 0) return null;
  return Math.max(0, 1 - item.damage / item.maxDamage);
});
</script>

<template>
  <button
    type="button"
    class="bg-muted ring-border relative size-8 shrink-0 rounded-sm ring-1 ring-inset sm:size-11"
    :class="{
      'ring-primary ring-2': selected,
      'ring-2 ring-amber-500/80': highlight && !selected,
      'hover:ring-primary/60': item,
    }"
    :disabled="!item"
    :title="item ? (item.customName ?? item.label) : undefined"
    :aria-label="item ? `${item.customName ?? item.label} × ${item.count}` : undefined"
    :aria-pressed="item ? selected : undefined"
    @click="item && emit('select', item)"
  >
    <template v-if="item">
      <ItemIcon :item="item" :icon="icons[item.icon]" :textures="textures" />
      <span
        v-if="item.enchantments.length > 0"
        class="glint pointer-events-none absolute inset-0 rounded-sm"
      />
      <span
        v-if="item.count > 1"
        class="absolute right-0.5 bottom-0 font-mono text-[0.7rem] leading-tight font-bold text-white [text-shadow:1px_1px_0_#000]"
        >{{ item.count }}</span
      >
      <span v-if="durability !== null" class="absolute inset-x-1 bottom-0.5 h-0.5 bg-black/70">
        <span
          class="block h-full"
          :style="{
            width: `${durability * 100}%`,
            backgroundColor: `hsl(${Math.round(durability * 120)} 85% 45%)`,
          }"
        />
      </span>
    </template>
  </button>
</template>

<style scoped>
.glint {
  background: linear-gradient(
    135deg,
    rgb(192 132 252 / 0.4),
    transparent 45%,
    transparent 55%,
    rgb(168 85 247 / 0.35)
  );
  mix-blend-mode: screen;
}
</style>
