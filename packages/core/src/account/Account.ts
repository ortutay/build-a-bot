import { eq } from 'drizzle-orm';
import type { GlobalContext } from '../context/index.js';
import type { ISerializable } from '../interface/ISerializable.js';
import type { ISaveable } from '../interface/ISaveable.js';
import type { StorageTransaction } from '../storage/Storage.js';
import { accountsTable } from '../storage/db/schema.js';
import { findById, findByKey } from '../storage/helpers.js';

export type AccountConfig = { username: string };

export type AccountOptions = AccountConfig & {
  context: GlobalContext;
  id?: string;
};

export class Account implements ISerializable<AccountConfig>, ISaveable {
  id: string | null;
  readonly username: string;
  #context: GlobalContext;

  constructor(options: AccountOptions) {
    this.#context = options.context;
    this.id = options.id ?? null;
    this.username = options.username;
  }

  get key(): string {
    return this.username;
  }

  static async findById(context: GlobalContext, id: string): Promise<Account | null> {
    const account = await findById(accountsTable, context, id);

    return account ? new Account({ context, ...account }) : null;
  }

  static async findByKey(context: GlobalContext, key: string): Promise<Account | null> {
    const account = await findByKey(accountsTable, context, key);

    return account ? new Account({ context, ...account }) : null;
  }

  static findByUsername(context: GlobalContext, username: string): Promise<Account | null> {
    return Account.findByKey(context, username);
  }

  static async local(context: GlobalContext, tx?: StorageTransaction): Promise<Account> {
    await context.init();
    const db = tx ?? context.storage.db;
    const [row] = await db
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.key, 'local'))
      .limit(1);
    if (row) {
      return new Account({ context, ...row });
    }

    const account = new Account({ context, username: 'local' });
    await account.save(tx);
    return account;
  }

  async save(tx?: StorageTransaction): Promise<void> {
    await this.#context.init();
    await this.#context.storage.fillInTransaction(tx, async (tx) => {
      const [account] = await tx
        .insert(accountsTable)
        .values({ key: this.key, username: this.username })
        .onConflictDoUpdate({
          target: accountsTable.key,
          set: { username: this.username },
        })
        .returning();
      if (!account) {
        throw new Error(`Could not save account: ${this.username}`);
      }

      this.id = account.id;
    });
  }

  async remove(tx?: StorageTransaction): Promise<void> {
    if (!this.id) {
      throw new Error('Cannot remove an unsaved account');
    }
    if (this.username === 'local') {
      throw new Error('Cannot remove the local account');
    }

    await this.#context.init();
    await this.#context.storage.fillInTransaction(tx, async (tx) => {
      await tx.delete(accountsTable).where(eq(accountsTable.id, this.id!));
      this.id = null;
    });
  }

  dump(): AccountConfig {
    return { username: this.username };
  }

  static load(config: AccountConfig, context: GlobalContext): Account {
    return new Account({ context, ...config });
  }
}
