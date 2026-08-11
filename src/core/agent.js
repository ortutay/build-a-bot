import { readFile } from 'node:fs/promises';
import { clip, hash } from './util.js';
import { DiskCache } from './cache/DiskCache.js';
import * as prompts from './prompts.js';

const cache = new DiskCache('/tmp');

const text = await readFile(new URL('./prompts.js', import.meta.url), 'utf8');
import { ask } from './ai.js';

export class Agent {
  constructor(model, toolkit) {
    this.model = model;
    this.toolkit = toolkit;
    this.messages = [
      { role: 'system', content: 'You are a helpful assistant.' },
    ];
    this.usage = {
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      cost: 0,
    };
  }

  state() {
    return {
      hasBrowser: Boolean(this.browser),
      hasPage: Boolean(this.page),
      url: this.page?.url() || '(no page)',
    };
  }

  push(message) {
    this.messages.push(message);
  }

  lastReply() {
    return this.messages
      .filter((message) => message.role === 'assistant')
      .at(-1);
  }

  async closeBrowser() {
    const browser = this.browser;
    this.browser = undefined;
    this.page = undefined;
    await browser?.close();
  }

  async useTool(toolCall) {
    const name = toolCall?.function?.name;
    const fn = this.toolkit.mapping[name];
    let output;

    const args = JSON.parse(toolCall.function.arguments);

    try {
      if (!fn) throw new Error(`Unknown tool: ${name || '(missing name)'}`);
      output = await fn(this, args);
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
      tool_call_id: toolCall.id,
      name,
      content,
    };
  }

  async run(content) {
    const key = hash({ model: this.model, content, text });
    const cached = await cache.get(key);
    if (cached) {
      return cached;
    }

    try {
      this.push({ role: 'user', content });

      for (let index = 0; index < 20; index++) {
        const reply = await this.step();
        if (reply.stop) break;

        this.push({
          role: 'user',
          content: prompts.browserState({ agent: this }),
        });
      }

      const out = {
        content: this.lastReply()?.content || '',
        usage: this.usage,
      };
      cache.set(key, out).catch((e) => console.warn(`Cache error: ${e}`));
      return out;
    } finally {
      await this.closeBrowser();
    }
  }

  async step() {
    const data = await ask({
      model: this.model,
      messages: this.messages,
      tools: this.toolkit.tools,
    });

    this.usage.promptTokens += data.usage?.prompt_tokens || 0;
    this.usage.completionTokens += data.usage?.completion_tokens || 0;
    this.usage.cachedTokens +=
      data.usage?.prompt_tokens_details?.cached_tokens || 0;
    this.usage.cost += data.usage?.cost || 0;

    const reply = data.choices[0];
    this.messages.push(reply.message);
    for (const toolCall of reply.message.tool_calls || []) {
      this.messages.push(await this.useTool(toolCall));
    }

    return { message: reply.message, stop: reply.finish_reason === 'stop' };
  }
}
