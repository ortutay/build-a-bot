import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/libsql';
import { log } from '../../src/internal/logger.js';
import { initializeDb, type Storage, type StorageTransaction } from '../../src/storage/Storage.js';

export type TemporaryDb = {
  storage: Storage;
  dispose: () => Promise<void>;
};

export const createTemporaryDb = async (): Promise<TemporaryDb> => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'build-a-bot-db-'));
  const dbUrl = `file:${path.join(rootDir, 'data.db')}`;
  log.info(`Creating temporary test database: ${dbUrl}`);
  const db = drizzle({ connection: { url: dbUrl } });
  await initializeDb(db);
  const storage = {
    db,
    fillInTransaction: async <T>(
      tx: StorageTransaction | undefined,
      fn: (tx: StorageTransaction) => Promise<T>
    ): Promise<T> => (tx ? fn(tx) : db.transaction(fn)),
    init: async () => {},
  } as Storage;

  return {
    storage,
    dispose: async () => {
      storage.db.$client.close();
      await rm(rootDir, { force: true, recursive: true });
    },
  };
};
