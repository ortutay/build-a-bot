import type { GlobalContext } from '../context/index.js';
import type { StorageTransaction } from '../storage/Storage.js';

export interface ISaveable {
  id: string | null;
  readonly key: string;
  save(tx?: StorageTransaction): Promise<void>;
  remove(tx?: StorageTransaction): Promise<void>;
}

export interface ISaveableClass<T> {
  findById(context: GlobalContext, id: string): Promise<T | null>;
  findByKey(context: GlobalContext, key: string): Promise<T | null>;
}

export const findConfigByKey = <T>(
  type: ISaveableClass<T>,
  context: GlobalContext,
  key: string
): Promise<T | null> => type.findByKey(context, key);
