import { pick } from 'radash';
import { log } from './logger.js';
// import { retryFetch } from './fetchers.js';
import { openrouterApiKey } from './constants.js';
import { Tool } from './tools/Tool.js';

export type AskRequest = {
  model: string;
  messages: Message[];
  tools: Tool[];
};

export type AskResponse = {
  readonly choices: Message[];
  readonly usage?: Usage;
};

export type Message = {
  readonly role?: string;
  readonly finishReason?: string;
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolCalls?: ToolCall[];
};

export type ToolCall = {
  readonly id: string;
  readonly function: {
    name: string;
    arguments: string; // TODO: parse the JSON?
  };
};

export type Usage = {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cost: number;
};

export const ask = async (req: AskRequest): Promise<AskResponse> => {
  const { model, messages, tools } = req;
  log.info('Asking AI...');

  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const apiKey = openrouterApiKey;

  const params = {
    model,
    messages,
    tools: tools.map((it) => it.asParameter),
    // TODO: more intelligent compression
    plugins: [{ id: 'context-compression' }],
  };
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // const resp = await retryFetch(url, {
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await resp.json();
  log.info(`AI responded, OK=${resp.ok}`);

  if (!resp.ok) {
    throw new Error(
      `AI request failed (${resp.status}): ${JSON.stringify(data, null, 2)}`
    );
  }
  if (!data.choices?.[0]?.message) {
    throw new Error(
      `AI returned no assistant message: ${JSON.stringify(data, null, 2)}`
    );
  }

  return {
    choices: data.choices.map((choice) => ({
      finishReason: choice.finish_reason,
      message: {
        role: choice.message.role,
        content: choice.message.content,
        toolCalls: (choice.message.tool_calls ?? []).map((toolCall) => ({
          id: toolCall.id,
          function: toolCall.function,
        })),
      },
    })),
    usage: data.usage && {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      cost: data.usage?.cost ?? 0,
    },
  };
};
