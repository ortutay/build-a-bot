import { readFile } from 'fs/promises';
import { log } from '../logger.js';
import { DiskCache } from '../cache/DiskCache.js';
import type { Tool } from '../tools/Tool.js';
import { ask, type Message, type Usage, type ToolCall } from '../ai.js';
import { clip, hash } from '../util.js';
import * as prompts from './prompts.js';

// Read text of prompts for cache busting
// TODO: More fine grained caching
const promptsText =
  (await readFile(new URL('./prompts.ts', import.meta.url), 'utf8')) +
  (await readFile(new URL('../workshop/prompts.ts', import.meta.url), 'utf8'));

export type AgentOptions = {
  readonly model?: string;
  readonly tools?: Tool[];
};

export type RunResult = {
  readonly content: string;
  readonly usage: Usage;
};

type StepResult = {
  readonly message: Message;
  readonly stop: boolean;
};

export const defaultOptions: AgentOptions = {
  model: 'openai/gpt-5.6-luna',
  tools: [],
};

export class Agent {
  model: string;
  tools: Tool[] = [];
  cache: DiskCache = new DiskCache('/tmp');
  messages: Message[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
  ];
  #usage: Usage = {
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    cost: 0,
  };

  constructor(options: AgentOptions) {
    this.model = options.model || defaultOptions.model!;
    this.tools = options.tools || defaultOptions.tools!;
  }

  get usage(): Readonly<Usage> {
    return this.#usage;
  }

  state(): { tools: string[] } {
    return { tools: this.tools.map((tool) => tool.name) };
  }

  tool(name: string): Tool | undefined {
    return this.tools.find((it) => it.name === name);
  }

  async run(content: string): Promise<RunResult> {
    log.info(
      `Run agent on prompt: ${clip(content, 100).replaceAll(/\n/g, ' ')}`
    );

    const key: string = hash({
      model: this.model,
      content,
      promptsText,
      // cb: 1
    });
    const cached = await this.cache.get(key);
    if (false && cached) {
      log.info(`Cache hit for key=${key}`);
      return cached as RunResult;
    }

    console.log('Run:', key);

    this.messages.push({ role: 'user', content });

    for (let i = 0; i < 10; i++) {
      log.info(`Step ${i + 1} of agent run`);
      const reply = await this.step();
      if (reply.stop) break;

      this.messages.push({
        role: 'user',
        content: prompts.agentState({
          agentState: JSON.stringify(this.state()),
        }),
      });
    }

    const last = this.messages
      .filter((message) => message.role === 'assistant')
      .at(-1);

    const result = {
      content: last?.content || '',
      usage: this.usage,
    };

    await this.cache.set(key, result);

    return result;
  }

  async step(): Promise<StepResult> {
    const data = await ask({
      model: this.model,
      messages: this.messages,
      tools: this.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
    });

    this.#usage.promptTokens += data.usage?.promptTokens || 0;
    this.#usage.completionTokens += data.usage?.completionTokens || 0;
    this.#usage.cachedTokens += data.usage?.cachedTokens || 0;
    this.#usage.cost += data.usage?.cost || 0;

    const reply = data.choices[0];
    this.messages.push(reply.message);
    for (const toolCall of reply.message.toolCalls || []) {
      console.log(toolCall);
      this.messages.push(await this.useTool(toolCall));
    }

    return { message: reply.message, stop: reply.finishReason === 'stop' };
  }

  async useTool(toolCall: ToolCall): Promise<Message> {
    const name = toolCall?.function?.name;

    const args = JSON.parse(toolCall.function.arguments);

    let output;
    try {
      const tool = this.tool(name);
      if (!tool) throw new Error(`Unknown tool: ${name || '(missing name)'}`);
      output = await tool.run(args);
    } catch (e) {
      output = `Tool use gave error: ${e}`;
    }

    const content =
      typeof output === 'string' ? output : JSON.stringify(output);
    console.log(
      `Tool output for ${name}(${clip(JSON.stringify(args))}):\n\t${clip(content)}`
    );
    return {
      role: 'tool',
      toolCallId: toolCall.id,
      name,
      content,
    };
  }
}
