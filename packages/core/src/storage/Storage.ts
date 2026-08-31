import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { storageDatabaseFilepath, storageDirectory } from '../internal/constants.js';
import { log } from '../internal/logger.js';

const migrationsFolder = fileURLToPath(new URL('../db/drizzle', import.meta.url));

export const initializeDb = async (db: ReturnType<typeof drizzle>): Promise<void> => {
  log.info(`Initialize storage migrations: ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
};

export class Storage {
  #db?: ReturnType<typeof drizzle>;
  #initialize?: Promise<void>;

  get db(): ReturnType<typeof drizzle> {
    if (!this.#db) {
      throw new Error('Storage has not been initialized');
    }
    return this.#db;
  }

  async initialize(): Promise<void> {
    this.#initialize ??= this.#initializeStorage();
    return this.#initialize;
  }

  async #initializeStorage(): Promise<void> {
    await mkdir(storageDirectory, { recursive: true });
    this.#db = drizzle({ connection: { url: storageDatabaseFilepath } });
    await initializeDb(this.#db);
  }
}
