import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { storageDatabaseFilepath, storageDirectory } from '../constants.js';
import { log } from '../logger.js';

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
  #transaction = Promise.resolve();

  get db(): StorageDb {
    if (!this.#db) {
      throw new Error('Storage has not been initialized');
    }
    return this.#db;
  }

  async init(): Promise<void> {
    this.#init ??= (async () => {
      await mkdir(storageDirectory, { recursive: true });
      this.#db = drizzle({ connection: { timeout: 5_000, url: storageDatabaseFilepath } });
      await initializeDb(this.#db);
    })();
    return this.#init;
  }

  async fillInTransaction<T>(
    tx: StorageTransaction | undefined,
    fn: (tx: StorageTransaction) => Promise<T>
  ): Promise<T> {
    await this.init();
    if (tx) {
      return fn(tx);
    }

    const previous = this.#transaction;
    let finish!: () => void;
    this.#transaction = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await previous;

    try {
      return await this.db.transaction(fn);
    } finally {
      finish();
    }
  }
}
