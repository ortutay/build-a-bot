import type { GlobalContext } from '../context/index.js';
import type { StorageTransaction } from '../storage/Storage.js';

export interface ISaveable {
  id: string | null;
  save(tx?: StorageTransaction): Promise<void>;
  remove(tx?: StorageTransaction): Promise<void>;
}

export interface ISaveableClass<T> {
  findById(context: GlobalContext, id: string): Promise<T | null>;
}
