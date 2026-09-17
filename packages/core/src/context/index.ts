import { type Mastra } from '@mastra/core';
import { DocumentLibrary, DiskLibraryBackend } from '../documents/index.js';
import { defaultMastra } from '../mastra/create.js';
import { BrowserSession } from '../mastra/tools/browserTools/BrowserSession.js';
import { closeTools } from '../mastra/tools/index.js';
import { NoProxy, ProxyRegistry } from '../proxy/index.js';
import { Storage } from '../storage/Storage.js';

export type GlobalOptions = {
  browserSession?: BrowserSession;
  documentLibrary?: DocumentLibrary;
  mastra?: Mastra;
  proxyRegistry?: ProxyRegistry;
  storage?: Storage;
};

const createDefaultProxyRegistry = (): ProxyRegistry => new ProxyRegistry([new NoProxy()]);

export class GlobalContext {
  readonly browserSession: BrowserSession;
  readonly documentLibrary: DocumentLibrary;
  readonly mastra: Mastra;
  readonly proxyRegistry: ProxyRegistry;
  readonly storage: Storage;
  private readonly closeFn: (context: GlobalContext) => Promise<void>;
  private closePromise?: Promise<void>;

  constructor(
    { browserSession, documentLibrary, mastra, proxyRegistry, storage }: Required<GlobalOptions>,
    closeFn: (context: GlobalContext) => Promise<void> = closeTools
  ) {
    this.browserSession = browserSession;
    this.documentLibrary = documentLibrary;
    this.mastra = mastra;
    this.proxyRegistry = proxyRegistry;
    this.storage = storage;
    this.closeFn = closeFn;
  }

  async init(): Promise<void> {
    await this.storage.init();
  }

  close(): Promise<void> {
    this.closePromise ??= Promise.resolve().then(() => this.closeFn(this));
    return this.closePromise;
  }
}

export const mergeContext = (context: GlobalContext, options?: GlobalOptions): GlobalContext => {
  // A synchronous merge cannot rebuild the tools captured by an existing Mastra.
  if (
    (options?.browserSession && options.browserSession !== context.browserSession) ||
    (options?.documentLibrary && options.documentLibrary !== context.documentLibrary) ||
    (options?.mastra && options.mastra !== context.mastra) ||
    (options?.proxyRegistry && options.proxyRegistry !== context.proxyRegistry)
  ) {
    throw new Error('Use createGlobalContext to replace browser or Mastra dependencies');
  }
  return new GlobalContext(
    {
      browserSession: context.browserSession,
      documentLibrary: options?.documentLibrary ?? context.documentLibrary,
      mastra: options?.mastra ?? context.mastra,
      proxyRegistry: options?.proxyRegistry ?? context.proxyRegistry,
      storage: options?.storage ?? context.storage,
    },
    // Merged views borrow resources; only their owning context closes them.
    async () => {}
  );
};

export const createGlobalContext = async (options: GlobalOptions = {}): Promise<GlobalContext> => {
  const storage = options.storage ?? new Storage();
  const documentLibrary =
    options.documentLibrary ??
    new DocumentLibrary(
      new DiskLibraryBackend('documentLibrary', { rootDir: '.build-a-bot/document-library' })
    );
  const proxyRegistry = options.proxyRegistry ?? createDefaultProxyRegistry();
  const browserSession = options.browserSession ?? new BrowserSession(proxyRegistry);
  if (browserSession.proxyRegistry !== proxyRegistry) {
    throw new Error('Browser session must use the context proxy registry');
  }
  let mastra = options.mastra;
  // An injected Mastra is borrowed. The session supplied to this context is owned.
  let closeFn: (context: GlobalContext) => Promise<void> = closeTools;

  if (!mastra) {
    const result = await defaultMastra({ browserSession, documentLibrary, proxyRegistry });
    mastra = result.mastra;
    closeFn = result.cleanup;
  }

  const context = new GlobalContext(
    {
      browserSession,
      storage,
      documentLibrary,
      mastra,
      proxyRegistry,
    },
    async (context) => {
      process.off('beforeExit', beforeExit);
      await closeFn(context);
    }
  );
  const beforeExit = () => {
    void context.close().catch((e) => {
      console.error('Failed to clean up BuildABot on process exit:', e);
    });
  };
  process.once('beforeExit', beforeExit);
  return context;
};

export { UsesContext, type UsesContextOptions } from './UsesContext.js';
