import { eq } from 'drizzle-orm';
import { log } from '../logger.js';
import { type RunStatus, runsTable } from '../storage/db/schema.js';
import { type Storage } from '../storage/Storage.js';

type StorageDb = Storage['db'];
type Transaction = Parameters<Parameters<StorageDb['transaction']>[0]>[0];

export type RunOptions = {
  id?: string;
  endTime?: string | null;
  error?: Record<string, unknown> | null;
  input: Record<string, unknown>;
  scriptId: string;
  startTime?: string;
  status?: RunStatus;
};

const errorData = (e: unknown): Record<string, unknown> => {
  if (e instanceof Error) {
    return { message: e.message, name: e.name, stack: e.stack ?? null };
  }

  return { message: String(e) };
};

export class Run {
  id: string | null;
  endTime: string | null;
  error: Record<string, unknown> | null;
  input: Record<string, unknown>;
  scriptId: string;
  startTime: string;
  status: RunStatus;

  constructor(options: RunOptions) {
    this.endTime = options.endTime ?? null;
    this.error = options.error ?? null;
    this.id = options.id ?? null;
    this.input = options.input;
    this.scriptId = options.scriptId;
    this.startTime = options.startTime ?? new Date().toISOString();
    this.status = options.status ?? 'active';
  }

  async save(storage: Storage, db: StorageDb | Transaction = storage.db): Promise<void> {
    const vals = {
      endTime: this.endTime,
      error: this.error,
      input: this.input,
      scriptId: this.scriptId,
      startTime: this.startTime,
      status: this.status,
    };

    if (this.id) {
      log.info(`Updating run id=${this.id}`);
      const [run] = await db
        .update(runsTable)
        .set(vals)
        .where(eq(runsTable.id, this.id))
        .returning();
      if (!run) {
        throw new Error(`Could not update run: ${this.id}`);
      }
      return;
    }

    log.info('Creating new run');
    const [run] = await db.insert(runsTable).values(vals).returning();
    if (!run) {
      throw new Error(`Could not save run for script: ${this.scriptId}`);
    }

    this.id = run.id;
  }

  async complete(storage: Storage, tx?: Transaction): Promise<void> {
    if (!this.id) {
      throw new Error('Cannot complete an unsaved run');
    }
    this.endTime = new Date().toISOString();
    this.status = 'done';
    await this.save(storage, tx ?? storage.db);
  }

  async fail(storage: Storage, e: unknown): Promise<void> {
    if (!this.id) {
      throw new Error('Cannot fail an unsaved run');
    }

    this.endTime = new Date().toISOString();
    this.error = errorData(e);
    this.status = 'error';
    await this.save(storage);
  }
}
