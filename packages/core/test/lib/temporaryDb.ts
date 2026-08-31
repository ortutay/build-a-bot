import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { drizzle } from 'drizzle-orm/libsql';
import { log } from '../../src/internal/logger.js';
import { Storage } from '../../src/storage/Storage.js';

const execFileAsync = promisify(execFile);
const drizzleKitPath = fileURLToPath(
  new URL('../../../../node_modules/.bin/drizzle-kit', import.meta.url)
);
const schemaPath = fileURLToPath(new URL('../../src/storage/db/schema.ts', import.meta.url));

export type TemporaryDb = {
  storage: Storage;
  dispose: () => Promise<void>;
};

export const createTemporaryDb = async (): Promise<TemporaryDb> => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'build-a-bot-db-'));
  const dbUrl = `file:${path.join(rootDir, 'data.db')}`;
  const configPath = path.join(rootDir, 'drizzle.config.ts');
  log.info(`Creating temporary test database: ${dbUrl}`);
  await writeFile(
    configPath,
    `export default ${JSON.stringify({
      dialect: 'sqlite',
      schema: schemaPath,
      dbCredentials: { url: dbUrl },
    })};\n`
  );
  await execFileAsync(drizzleKitPath, ['push', '--config', configPath], { cwd: rootDir });

  const storage = new Storage(drizzle({ connection: { url: dbUrl } }));

  return {
    storage,
    dispose: async () => {
      storage.db.$client.close();
      await rm(rootDir, { force: true, recursive: true });
    },
  };
};
