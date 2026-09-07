import { type Mastra } from '@mastra/core';
import { DocumentLibrary, DiskLibraryBackend } from '../internal/documents/index.js';
import { defaultMastra } from '../internal/mastra/index.js';
import { Storage } from '../storage/Storage.js';

export type GlobalOptions = {
  mastra?: Mastra;
  storage?: Storage;
  documentLibrary?: DocumentLibrary;
};

export type GlobalContext = {
  mastra: Mastra;
  storage: Storage;
  documentLibrary: DocumentLibrary;
  init: () => Promise<void>;
};

export const mergeContext = (context: GlobalContext, options?: GlobalOptions): GlobalContext => {
  return {
    mastra: options?.mastra ?? context.mastra,
    storage: options?.storage ?? context.storage,
    documentLibrary: options?.documentLibrary ?? context.documentLibrary,
    init: async () => (options?.storage ?? context.storage).init(),
  };
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

  return {
    storage,
    documentLibrary,
    mastra,
    init: async () => storage.init(),
  };
};
