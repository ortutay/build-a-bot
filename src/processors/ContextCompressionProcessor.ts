import type { MastraDBMessage } from '@mastra/core/agent/message-list';
import type { ProcessInputStepArgs, Processor } from '@mastra/core/processors';

export type ContextCompressionOptions = {
  /** Maximum serialized characters retained from one tool result. */
  maxCharsPerToolResult?: number;
};

const DEFAULT_MAX_CHARS_PER_TOOL_RESULT = 24_000;

/**
 * Keeps a bounded, useful view of large tool results in the agent transcript.
 *
 * Tool results often contain complete HTML documents. Retaining the beginning
 * and end preserves the document's structure while ensuring a single response
 * cannot exhaust the model context window.
 */
export class ContextCompressionProcessor implements Processor<'context-compression'> {
  readonly id = 'context-compression';
  readonly name = 'Context Compression';

  #maxCharsPerToolResult: number;

  constructor(options: ContextCompressionOptions = {}) {
    this.#maxCharsPerToolResult =
      options.maxCharsPerToolResult ?? DEFAULT_MAX_CHARS_PER_TOOL_RESULT;
  }

  processInputStep({ messages }: ProcessInputStepArgs): MastraDBMessage[] {
    return messages.map((message) => this.compressMessage(message));
  }

  private compressMessage(message: MastraDBMessage): MastraDBMessage {
    let changed = false;
    const parts = message.content.parts.map((part) => {
      if (part.type !== 'tool-invocation' || part.toolInvocation.result === undefined) {
        return part;
      }

      const result = this.compressResult(part.toolInvocation.result);
      if (result === part.toolInvocation.result) return part;

      changed = true;
      return {
        ...part,
        toolInvocation: { ...part.toolInvocation, result },
      };
    });

    if (!changed) return message;

    return {
      ...message,
      content: { ...message.content, parts },
    };
  }

  private compressResult(result: unknown): unknown {
    if (typeof result === 'string') return this.compressText(result);

    if (Array.isArray(result)) {
      let changed = false;
      const compressed = result.map((item) => {
        const value = this.compressResult(item);
        if (value !== item) changed = true;
        return value;
      });

      return changed ? compressed : result;
    }

    if (!this.isPlainObject(result)) return result;

    let changed = false;
    const compressed = Object.fromEntries(
      Object.entries(result).map(([key, value]) => {
        const compressedValue = this.compressResult(value);
        if (compressedValue !== value) changed = true;
        return [key, compressedValue];
      })
    );

    return changed ? compressed : result;
  }

  private compressText(text: string): string {
    if (text.length <= this.#maxCharsPerToolResult) return text;

    const marker = `[context compressed: ${text.length} characters]`;
    // Account for the newline after the marker and the newline-plus-ellipsis
    // inserted between the retained head and tail.
    const remaining = this.#maxCharsPerToolResult - marker.length - 3;
    const headLength = Math.ceil(remaining * 0.75);
    const tailLength = remaining - headLength;

    return `${marker}\n${text.slice(0, headLength)}\n…${text.slice(-tailLength)}`;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') return false;

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }
}
