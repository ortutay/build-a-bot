import { eq } from 'drizzle-orm';
import type { GlobalContext } from '../context/index.js';
import { UsesContext, type UsesContextOptions } from '../context/UsesContext.js';
import type { ISerializable } from '../interface/ISerializable.js';
import type { ISaveable } from '../interface/ISaveable.js';
import type { StorageTransaction } from '../storage/Storage.js';
import { accountsTable } from '../storage/db/schema.js';
import { findById } from '../storage/helpers.js';

export type AccountConfig = { username: string };

export type AccountOptions = AccountConfig &
  UsesContextOptions & {
    id?: string;
  };

export class Account extends UsesContext implements ISerializable<AccountConfig>, ISaveable {
  id: string | null;
  username: string;

  constructor(options: AccountOptions) {
    super(options);
    this.id = options.id ?? null;
    this.username = options.username;
  }

  static async findById(
    context: GlobalContext,
    id: string,
    tx?: StorageTransaction
  ): Promise<Account | null> {
    const account = await findById(accountsTable, context, id, tx);

    return account ? new Account({ context, ...account }) : null;
  }

  static async findByUsername(
    context: GlobalContext,
    username: string,
    tx?: StorageTransaction
  ): Promise<Account | null> {
    await context.init();
    const db = tx ?? context.storage.db;
    const [account] = await db
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.username, username))
      .limit(1);

    return account ? new Account({ context, ...account }) : null;
  }

  static async local(context: GlobalContext, tx?: StorageTransaction): Promise<Account> {
    await context.init();

    const local = await context.storage.fillInTransaction(tx, async (tx) => {
      const existing = await this.findByUsername(context, 'local', tx);
      if (existing) {
        return existing;
      } else {
        const account = new Account({ context, username: 'local' });
        await account.save(tx);
        return account;
      }
    });

    return local;
  }

  static load(config: AccountConfig, context: GlobalContext): Account {
    return new Account({ context, ...config });
  }

  async save(tx?: StorageTransaction): Promise<void> {
    const context = await this.context();

    await context.storage.fillInTransaction(tx, async (tx) => {
      const [account] = await tx
        .insert(accountsTable)
        .values({ username: this.username })
        .onConflictDoUpdate({
          target: accountsTable.username,
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
    const context = await this.context();

    if (!this.id) {
      throw new Error('Cannot remove an unsaved account');
    }
    if (this.username === 'local') {
      throw new Error('Cannot remove the local account');
    }

    await context.storage.fillInTransaction(tx, async (tx) => {
      await tx.delete(accountsTable).where(eq(accountsTable.id, this.id!));
      this.id = null;
    });
  }

  dump(): AccountConfig {
    return { username: this.username };
  }
}
