import { Mastra } from '@mastra/core';
import { DocumentLibrary } from '../internal/documents/DocumentLibrary.js';
import { Storage } from '../storage/Storage.js';
import { defaultMastra } from '../internal/mastra/index.js';
// import { defaultMastra as internalDefaultMastra } from '../internal/mastra/index.js';

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
  const context = {};
  if (!options.storage) {
    options.storage = new Storage();
  }
  if (!options.documentLibrary) {
    options.documentLibrary = new DocumentLibrary();
  }
  if (!options.mastra) {
    const { mastra, cleanup } = await defaultMastra({ documentLibrary: options.documentLibrary });
    options.mastra = mastra;
    process.once('beforeExit', () => {
      void cleanup().catch((e) => {
        console.error('Failed to clean up BuildABot on process exit:', e);
      });
    });
  }
  return {
    storage: options.storage,
    documentLibrary: options.documentLibrary,
    mastra: options.mastra,
  };
};

// export const defaultStorage = (): Storage => new Storage();
// export const defaultDocumentLibrary = (): DocumentLibrary => new DocumentLibrary();
