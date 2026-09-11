import type { Mastra } from '@mastra/core';
import { and, eq } from 'drizzle-orm';
import type { GlobalContext } from '../context/index.js';
import { UsesContext, type UsesContextOptions } from '../context/UsesContext.js';
import type { StorageTransaction } from '../storage/Storage.js';
import { scriptsTable } from '../storage/db/schema.js';
import { findById } from '../storage/helpers.js';
import { Bot } from '../bot/Bot.js';
import { selectAvailableTools } from '../mastra/instruments/availableTools.js';
import { getOrNull } from '../util/index.js';
import { availableContext, availableModules, Compiler } from './Compiler.js';
import { toContextTools } from './tool-fns.js';

export type ScriptOptions = UsesContextOptions & {
  id?: string;
  buildInput?: Record<string, unknown> | null;
  dataServiceId?: string;
  name: string;
  code: string;
  exports?: string[];
  modules: string[];
  tools: string[];
  vmContext: string[];
};

export class ScriptDependencyUnavailableError extends Error {
  constructor(type: string, dependencyName: string) {
    super(`Script dependency is not available: ${type} ${dependencyName}`);
    this.name = 'ScriptDependencyUnavailableError';
  }
}

const selectDependencies = (
  available: unknown,
  names: string[],
  type: string
): Record<string, unknown> => {
  return Object.fromEntries(
    names.map((name) => {
      const val = getOrNull<unknown>(available, name);
      if (val === null) {
        throw new ScriptDependencyUnavailableError(type, name);
      }

      return [name, val];
    })
  );
};

export class Script extends UsesContext {
  id: string | null;
  dataServiceId: string | null;
  buildInput: Record<string, unknown> | null;
  code: string;
  exports: string[];
  modules: string[];
  name: string;
  tools: string[];
  vmContext: string[];

  constructor(options: ScriptOptions) {
    super(options);
    this.id = options.id ?? null;
    this.dataServiceId = options.dataServiceId ?? null;
    this.buildInput = options.buildInput ?? null;
    this.code = options.code;
    this.exports = options.exports ?? [];
    this.modules = options.modules;
    this.name = options.name;
    this.tools = options.tools;
    this.vmContext = options.vmContext;
  }

  static async findById(context: GlobalContext, id: string): Promise<Script | null> {
    const script = await findById(scriptsTable, context, id);

    return script ? new Script({ ...script, context }) : null;
  }

  static async findByName(
    context: GlobalContext,
    dataServiceId: string,
    name: string
  ): Promise<Script | null> {
    await context.init();
    const [script] = await context.storage.db
      .select()
      .from(scriptsTable)
      .where(and(eq(scriptsTable.dataServiceId, dataServiceId), eq(scriptsTable.name, name)))
      .limit(1);

    return script ? new Script({ ...script, context }) : null;
  }

  static async findByBuildUrl(
    context: GlobalContext,
    dataServiceId: string,
    url: string
  ): Promise<Script | null> {
    await context.init();
    const scripts = await context.storage.db
      .select()
      .from(scriptsTable)
      .where(eq(scriptsTable.dataServiceId, dataServiceId));
    const script = scripts.find((val) => {
      const urls = val.buildInput?.urls;
      return Array.isArray(urls) && urls.includes(url);
    });

    return script ? new Script({ ...script, context }) : null;
  }

  async compile(mastra?: Mastra): Promise<Bot> {
    const vmContext = selectDependencies(availableContext, this.vmContext, 'context');
    const modules = selectDependencies(availableModules, this.modules, 'module');
    const activeMastra = mastra ?? (await this.context()).mastra;
    const tools = selectDependencies(
      selectAvailableTools(activeMastra.listTools() ?? {}),
      this.tools,
      'tool'
    );
    const compiler = new Compiler();

    return new Bot(
      await compiler.compile(this.code, {
        additionalContext: {
          ...vmContext,
          ...modules,
          tools: toContextTools(tools),
        },
      })
    );
  }

  async save(tx?: StorageTransaction): Promise<void> {
    const dataServiceId = this.dataServiceId;
    if (!dataServiceId) {
      throw new Error(`Cannot save a script without a data service: ${this.name}`);
    }

    const context = await this.context();
    await context.storage.fillInTransaction(tx, async (tx) => {
      const vals = {
        buildInput: this.buildInput,
        code: this.code,
        exports: this.exports,
        modules: this.modules,
        name: this.name,
        dataServiceId,
        tools: this.tools,
        vmContext: this.vmContext,
      };
      if (this.id) {
        const [script] = await tx
          .update(scriptsTable)
          .set(vals)
          .where(eq(scriptsTable.id, this.id))
          .returning();
        if (script) {
          return;
        }
      }

      const [script] = await tx
        .insert(scriptsTable)
        .values(vals)
        .onConflictDoUpdate({
          target: [scriptsTable.dataServiceId, scriptsTable.name],
          set: vals,
        })
        .returning();
      if (!script) {
        throw new Error(`Could not save script: ${this.name}`);
      }

      this.id = script.id;
    });
  }

  async remove(tx?: StorageTransaction): Promise<void> {
    if (!this.id) {
      throw new Error('Cannot remove an unsaved script');
    }

    const context = await this.context();
    await context.storage.fillInTransaction(tx, async (tx) => {
      await tx.delete(scriptsTable).where(eq(scriptsTable.id, this.id!));
      this.id = null;
    });
  }
}
