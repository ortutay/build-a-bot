import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import {
  storageDatabaseFilepath,
  storageDatabasePath,
  storageDirectory,
  storageSchemaVersion,
} from '../constants.js';
import { log } from '../logger.js';

export type StorageDb = ReturnType<typeof drizzle>;
export type StorageTransaction = Parameters<Parameters<StorageDb['transaction']>[0]>[0];

const migrationsFolder = fileURLToPath(new URL('../db/drizzle', import.meta.url));
const storageSchemaVersionPath = `${storageDirectory}/storage-schema-version`;
const lockDir = `${storageDirectory}/storage-init.lock`;

const lockStorage = async (): Promise<() => Promise<void>> => {
  const deadline = Date.now() + 10_000;
  while (true) {
    try {
      await mkdir(lockDir);
      return () => rmdir(lockDir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw e;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for storage initialization lock: ${lockDir}`);
      }
      await setTimeout(25);
    }
  }
};

const resetStorageForSchemaVersion = async (): Promise<void> => {
  const version = await readFile(storageSchemaVersionPath, 'utf8').catch(
    (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') {
        return null;
      }
      throw e;
    }
  );
  if (version?.trim() === storageSchemaVersion) {
    return;
  }

  log.warn(`Resetting local storage for schema version=${storageSchemaVersion}`);
  await Promise.all(
    [storageDatabasePath, `${storageDatabasePath}-shm`, `${storageDatabasePath}-wal`].map((path) =>
      rm(path, { force: true })
    )
  );
};

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
      const unlock = await lockStorage();
      try {
        await resetStorageForSchemaVersion();
        const db = drizzle({ connection: { timeout: 5_000, url: storageDatabaseFilepath } });
        try {
          await initializeDb(db);
          await writeFile(storageSchemaVersionPath, `${storageSchemaVersion}\n`);
          this.#db = db;
        } catch (e) {
          db.$client.close();
          throw e;
        }
      } finally {
        await unlock();
      }
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
