<script setup lang="ts">
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@outpost/ui';
import FlashMessage from './FlashMessage.vue';
import ThemeToggle from './ThemeToggle.vue';

defineProps<{ title: string; description?: string }>();
</script>

<template>
  <main class="bg-muted/40 relative flex min-h-full items-center justify-center p-4">
    <!-- Before login the theme is remembered in this browser only. -->
    <ThemeToggle class="absolute top-4 right-4" />
    <div class="flex w-full max-w-sm flex-col gap-6">
      <div class="flex items-center justify-center gap-2">
        <img src="/favicon.svg" alt="" class="size-8" />
        <span class="text-xl font-semibold">Outpost</span>
      </div>
      <FlashMessage />
      <Card>
        <CardHeader>
          <CardTitle class="text-lg">{{ title }}</CardTitle>
          <CardDescription v-if="description">{{ description }}</CardDescription>
        </CardHeader>
        <CardContent>
          <slot />
        </CardContent>
      </Card>
    </div>
  </main>
</template>
