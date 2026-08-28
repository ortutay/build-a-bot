import { type Mastra } from '@mastra/core';
import { DocumentLibrary } from '../internal/documents/DocumentLibrary.js';
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
};

export const fillInContext = async (options: GlobalOptions): Promise<GlobalContext> => {
  const storage = options.storage ?? new Storage();
  const documentLibrary = options.documentLibrary ?? new DocumentLibrary();
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
  };
};
