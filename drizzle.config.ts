import { defineConfig } from 'drizzle-kit';
import { storageDatabaseFilepath } from './packages/core/src/internal/constants.js';

export default defineConfig({
  dialect: 'sqlite',
  schema: './packages/core/src/storage/db/schema.ts',
  dbCredentials: {
    url: storageDatabaseFilepath,
  },
});
