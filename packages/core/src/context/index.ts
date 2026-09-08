import { type Mastra } from '@mastra/core';
import { DocumentLibrary, DiskLibraryBackend } from '../documents/index.js';
import { defaultMastra } from '../mastra/index.js';
import { Storage } from '../storage/Storage.js';

export type GlobalOptions = {
  mastra?: Mastra;
  storage?: Storage;
  documentLibrary?: DocumentLibrary;
};

export class GlobalContext {
  readonly documentLibrary: DocumentLibrary;
  readonly mastra: Mastra;
  readonly storage: Storage;

  constructor({ documentLibrary, mastra, storage }: Required<GlobalOptions>) {
    this.documentLibrary = documentLibrary;
    this.mastra = mastra;
    this.storage = storage;
  }

  async init(): Promise<void> {
    await this.storage.init();
  }
}

export const mergeContext = (context: GlobalContext, options?: GlobalOptions): GlobalContext => {
  return new GlobalContext({
    mastra: options?.mastra ?? context.mastra,
    storage: options?.storage ?? context.storage,
    documentLibrary: options?.documentLibrary ?? context.documentLibrary,
  });
};

export const createGlobalContext = async (options: GlobalOptions = {}): Promise<GlobalContext> => {
  const storage = options.storage ?? new Storage();
  const documentLibrary =
    options.documentLibrary ??
    new DocumentLibrary(
      new DiskLibraryBackend('documentLibrary', { rootDir: '.build-a-bot/document-library' })
    );
  let mastra = options.mastra;

  if (!mastra) {
    const result = await defaultMastra({ documentLibrary });
    mastra = result.mastra;
    process.once('beforeExit', () => {
      void result.cleanup().catch((e) => {
        console.error('Failed to clean up BuildABot on process exit:', e);
      });
    });
  }

  return new GlobalContext({
    storage,
    documentLibrary,
    mastra,
  });
};

export { UsesContext, type UsesContextOptions } from './UsesContext.js';
