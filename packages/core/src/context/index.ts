import { type Mastra } from '@mastra/core';
import { DocumentLibrary, DiskLibraryBackend } from '../documents/index.js';
import { defaultMastra } from '../mastra/index.js';
import { NoProxy, ProxyRegistry } from '../proxy/index.js';
import { Storage } from '../storage/Storage.js';

export type GlobalOptions = {
  documentLibrary?: DocumentLibrary;
  mastra?: Mastra;
  proxyRegistry?: ProxyRegistry;
  storage?: Storage;
};

const createDefaultProxyRegistry = (): ProxyRegistry => new ProxyRegistry([new NoProxy()]);

export class GlobalContext {
  readonly documentLibrary: DocumentLibrary;
  readonly mastra: Mastra;
  readonly proxyRegistry: ProxyRegistry;
  readonly storage: Storage;

  constructor({ documentLibrary, mastra, proxyRegistry, storage }: Required<GlobalOptions>) {
    this.documentLibrary = documentLibrary;
    this.mastra = mastra;
    this.proxyRegistry = proxyRegistry;
    this.storage = storage;
  }

  async init(): Promise<void> {
    await this.storage.init();
  }
}

export const mergeContext = (context: GlobalContext, options?: GlobalOptions): GlobalContext => {
  return new GlobalContext({
    documentLibrary: options?.documentLibrary ?? context.documentLibrary,
    mastra: options?.mastra ?? context.mastra,
    proxyRegistry: options?.proxyRegistry ?? context.proxyRegistry,
    storage: options?.storage ?? context.storage,
  });
};

export const createGlobalContext = async (options: GlobalOptions = {}): Promise<GlobalContext> => {
  const storage = options.storage ?? new Storage();
  const documentLibrary =
    options.documentLibrary ??
    new DocumentLibrary(
      new DiskLibraryBackend('documentLibrary', { rootDir: '.build-a-bot/document-library' })
    );
  const proxyRegistry = options.proxyRegistry ?? createDefaultProxyRegistry();
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
    proxyRegistry,
  });
};

export { UsesContext, type UsesContextOptions } from './UsesContext.js';
