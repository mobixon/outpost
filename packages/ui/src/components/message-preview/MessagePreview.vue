<script setup lang="ts">
/** A piece of a chat line with the formatting of its `&` codes. */
export interface MessagePreviewPart {
  text: string;
  /** The color for the web. */
  color?: { hex: string };
  bold?: boolean;
  italic?: boolean;
  underlined?: boolean;
  strikethrough?: boolean;
}

defineProps<{
  /** The lines of the message, each split into parts. */
  lines: readonly (readonly MessagePreviewPart[])[];
  /** Says what the preview is for, for screen readers. */
  label?: string;
}>();
</script>

<template>
  <div
    class="flex flex-col gap-1 rounded-md border border-white/10 bg-neutral-900 px-3 py-2 font-mono text-sm text-white"
    :aria-label="label"
  >
    <p v-for="(line, index) in lines" :key="index" class="break-words">
      <span
        v-for="(part, partIndex) in line"
        :key="partIndex"
        :style="{ color: part.color?.hex }"
        :class="{
          'font-bold': part.bold,
          italic: part.italic,
          underline: part.underlined,
          'line-through': part.strikethrough,
        }"
        >{{ part.text }}</span
      >
    </p>
  </div>
</template>
