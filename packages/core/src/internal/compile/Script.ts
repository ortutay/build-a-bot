import type { Mastra } from '@mastra/core';
import { and, eq } from 'drizzle-orm';
import { scriptsTable, servicesTable } from '../../storage/db/schema.js';
import { type Storage } from '../../storage/Storage.js';
import { Bot } from '../bot/Bot.js';
import { log } from '../logger.js';
import { selectAvailableTools } from '../mastra/instruments/availableTools.js';
import { getOrNull } from '../util/index.js';
import { availableContext, availableModules, Compiler } from './Compiler.js';
import { toContextTools } from './tool-fns.js';

export type ScriptOptions = {
  buildInput?: Record<string, unknown> | null;
  id?: string;
  serviceId?: string;
  name: string;
  code: string;
  exports?: string[];
  context: string[];
  modules: string[];
  tools: string[];
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

export class Script {
  buildInput: Record<string, unknown> | null;
  id: string | null;
  serviceId: string | null;
  name: string;
  code: string;
  exports: string[];
  context: string[];
  modules: string[];
  tools: string[];

  constructor(options: ScriptOptions) {
    this.buildInput = options.buildInput ?? null;
    this.id = options.id ?? null;
    this.serviceId = options.serviceId ?? null;
    this.name = options.name;
    this.code = options.code;
    this.exports = options.exports ?? [];
    this.context = options.context;
    this.modules = options.modules;
    this.tools = options.tools;
  }

  static async findById(storage: Storage, id: string): Promise<Script | null> {
    log.debug(`Find script by ID: ${id}`);
    const { db } = storage;
    const [script] = await db.select().from(scriptsTable).where(eq(scriptsTable.id, id)).limit(1);

    return script ? new Script(script) : null;
  }

  static async findByName(
    storage: Storage,
    serviceName: string,
    name: string
  ): Promise<Script | null> {
    log.debug(`Find script: service=${serviceName}, name=${name}`);
    const { db } = storage;
    const [result] = await db
      .select({ script: scriptsTable })
      .from(scriptsTable)
      .innerJoin(servicesTable, eq(scriptsTable.serviceId, servicesTable.id))
      .where(and(eq(servicesTable.name, serviceName), eq(scriptsTable.name, name)))
      .limit(1);

    return result ? new Script(result.script) : null;
  }

  async compile(mastra: Mastra): Promise<Bot> {
    log.debug(
      `Compile script: name=${this.name}, context=${JSON.stringify(this.context)}, modules=${JSON.stringify(this.modules)}, tools=${JSON.stringify(this.tools)}`
    );
    const context = selectDependencies(availableContext, this.context, 'context');
    const modules = selectDependencies(availableModules, this.modules, 'module');
    const tools = selectDependencies(
      selectAvailableTools(mastra.listTools() ?? {}),
      this.tools,
      'tool'
    );
    const compiler = new Compiler();

    return new Bot(
      await compiler.compile(this.code, {
        additionalContext: {
          ...context,
          ...modules,
          tools: toContextTools(tools),
        },
      })
    );
  }

  async save(storage: Storage, serviceName: string): Promise<void> {
    log.debug(`Save script: service=${serviceName}, name=${this.name}, id=${this.id}`);
    const { db } = storage;
    const [service] = await db
      .insert(servicesTable)
      .values({ name: serviceName })
      .onConflictDoUpdate({
        target: servicesTable.name,
        set: { name: serviceName },
      })
      .returning();
    if (!service) {
      throw new Error(`Could not sync service: ${serviceName}`);
    }

    this.serviceId = service.id;
    const vals = {
      serviceId: service.id,
      name: this.name,
      code: this.code,
      buildInput: this.buildInput,
      exports: this.exports,
      context: this.context,
      modules: this.modules,
      tools: this.tools,
    };

    if (this.id) {
      const [script] = await db
        .update(scriptsTable)
        .set(vals)
        .where(eq(scriptsTable.id, this.id))
        .returning();
      if (script) {
        log.debug(`Updated script: ${this.id}`);
        return;
      }
    }

    const [script] = await db.insert(scriptsTable).values(vals).returning();
    if (!script) {
      throw new Error(`Could not sync script: ${this.name}`);
    }

    this.id = script.id;
    log.debug(`Saved script: ${this.id}`);
  }

  async remove(storage: Storage): Promise<void> {
    if (!this.id) {
      throw new Error('Cannot remove an unsaved script');
    }

    const [script] = await storage.db
      .delete(scriptsTable)
      .where(eq(scriptsTable.id, this.id))
      .returning();
    if (!script) {
      throw new Error(`Could not remove script: ${this.id}`);
    }

    this.id = null;
  }
}
