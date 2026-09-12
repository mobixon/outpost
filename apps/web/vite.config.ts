import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const api = 'http://localhost:3000';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    // Plugins live in other workspace packages; make sure they share one copy of each library.
    dedupe: ['vue', 'vue-router', 'vue-i18n', 'reka-ui'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: api, ws: true },
      '/healthz': api,
      '/readyz': api,
    },
  },
});
