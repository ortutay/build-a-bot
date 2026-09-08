import type { GlobalContext } from './index.js';

export type UsesContextOptions = { context?: GlobalContext };

export class UsesContext {
  #context?: GlobalContext;
  #contextPromise?: Promise<GlobalContext>;

  constructor({ context }: UsesContextOptions = {}) {
    this.#context = context;
    this.#contextPromise = context ? Promise.resolve(context) : undefined;
  }

  async context(): Promise<GlobalContext> {
    this.#context ??= await (this.#contextPromise ??= this.#createContext());
    await this.#context.init();
    return this.#context;
  }

  bindContext(context: GlobalContext): void {
    if (this.#context && this.#context !== context) {
      throw new Error('Context is already bound');
    }
    if (this.#contextPromise && !this.#context) {
      throw new Error('Context is already being created');
    }

    this.#context = context;
    this.#contextPromise = Promise.resolve(context);
  }

  protected boundContext(): GlobalContext | undefined {
    return this.#context;
  }

  async #createContext(): Promise<GlobalContext> {
    const { createGlobalContext } = await import('./index.js');
    return createGlobalContext();
  }
}
