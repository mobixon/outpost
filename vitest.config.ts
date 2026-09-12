import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{apps,packages,plugins}/*/src/**/*.test.ts'],
  },
});
