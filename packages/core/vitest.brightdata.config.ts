import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/test/proxy/brightdata.test.ts'],
  },
});
