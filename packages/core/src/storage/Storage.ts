import { drizzle } from 'drizzle-orm/libsql';
import { storageDatabaseFilepath } from '../internal/constants.js';

export class Storage {
  db: ReturnType<typeof drizzle>;

  constructor(db?: ReturnType<typeof drizzle>) {
    this.db = db ?? drizzle({ connection: { url: storageDatabaseFilepath } });
  }
}
