import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { storageDatabaseFilepath, storageDirectory } from '../internal/constants.js';
import { log } from '../internal/logger.js';

export type StorageDb = ReturnType<typeof drizzle>;
export type StorageTransaction = Parameters<Parameters<StorageDb['transaction']>[0]>[0];

const migrationsFolder = fileURLToPath(new URL('../db/drizzle', import.meta.url));

export const initializeDb = async (db: StorageDb): Promise<void> => {
  log.info(`Initialize storage migrations: ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
};

export class Storage {
  #db?: StorageDb;
  #init?: Promise<void>;

  get db(): StorageDb {
    if (!this.#db) {
      throw new Error('Storage has not been initialized');
    }
    return this.#db;
  }

  async init(): Promise<void> {
    this.#init ??= (async () => {
      await mkdir(storageDirectory, { recursive: true });
      this.#db = drizzle({ connection: { url: storageDatabaseFilepath } });
      await initializeDb(this.#db);
    })();
    return this.#init;
  }

  async fillInTransaction<T>(
    tx: StorageTransaction | undefined,
    fn: (tx: StorageTransaction) => Promise<T>
  ): Promise<T> {
    await this.init();
    return tx ? fn(tx) : this.db.transaction(fn);
  }
}
