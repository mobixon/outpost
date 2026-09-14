<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Icon, IconLayer, StoredItem } from '../shared.js';
import { frameOf } from './textures.js';

const props = defineProps<{
  item: StoredItem;
  icon: Icon | undefined;
  textures: Record<string, string>;
}>();

const layers = ref<string[]>([]);
const faces = ref<{ top: string; left: string; right: string } | null>(null);

let run = 0;
watch(
  () => [props.icon, props.textures] as const,
  async ([icon, textures]) => {
    const current = ++run;
    const frame = (layer: IconLayer) => {
      const url = textures[layer.texture];
      return url === undefined ? Promise.resolve(null) : frameOf(url, layer.tint);
    };
    let nextLayers: string[] = [];
    let nextFaces: typeof faces.value = null;
    try {
      if (icon?.kind === 'flat') {
        nextLayers = (await Promise.all(icon.layers.map(frame))).filter(
          (url): url is string => url !== null,
        );
      } else if (icon?.kind === 'cube') {
        const [top, left, right] = await Promise.all([icon.top, icon.left, icon.right].map(frame));
        if (top && left && right) nextFaces = { top, left, right };
      }
    } catch {
      nextLayers = [];
      nextFaces = null;
    }
    if (current !== run) return;
    layers.value = nextLayers;
    faces.value = nextFaces;
  },
  { immediate: true },
);

const letter = computed(() => (props.item.customName ?? props.item.label).charAt(0).toUpperCase());
const hue = computed(() => {
  let hash = 0;
  for (const char of props.item.id) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
});
</script>

<template>
  <span class="relative block size-full" aria-hidden="true">
    <span v-if="faces" class="cube">
      <span class="face top" :style="{ backgroundImage: `url(${faces.top})` }" />
      <span class="face left" :style="{ backgroundImage: `url(${faces.left})` }" />
      <span class="face right" :style="{ backgroundImage: `url(${faces.right})` }" />
    </span>
    <template v-else-if="layers.length > 0">
      <img
        v-for="(source, index) in layers"
        :key="index"
        :src="source"
        alt=""
        class="pixelated absolute inset-[12%] size-[76%]"
      />
    </template>
    <span
      v-else
      class="absolute inset-[18%] flex items-center justify-center rounded-sm font-mono text-xs font-semibold text-white"
      :style="{ backgroundColor: `hsl(${hue} 40% 38%)` }"
      >{{ letter }}</span
    >
  </span>
</template>

<style scoped>
.pixelated {
  image-rendering: pixelated;
}

/* A block drawn like the game draws it in the inventory: seen from above at an angle. */
.cube {
  --edge: 1.05rem;
  position: absolute;
  top: 50%;
  left: 50%;
  width: var(--edge);
  height: var(--edge);
  transform: translate(-50%, -42%) rotateX(-30deg) rotateY(-45deg);
  transform-style: preserve-3d;
}

@media (min-width: 40rem) {
  .cube {
    --edge: 1.5rem;
  }
}

.face {
  position: absolute;
  inset: 0;
  background-size: 100% 100%;
  image-rendering: pixelated;
}

.top {
  transform: rotateX(90deg) translateZ(calc(var(--edge) / 2));
}

.left {
  transform: translateZ(calc(var(--edge) / 2));
  filter: brightness(0.8);
}

.right {
  transform: rotateY(90deg) translateZ(calc(var(--edge) / 2));
  filter: brightness(0.6);
}
</style>
