import { log } from './logger.js';
import { openrouterApiKey } from './constants.js';
import type { JSONSchema } from 'json-schema-to-ts';
import { retry } from 'radash';

export type AskRequest = {
  model: string;
  messages: Message[];
  tools: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: JSONSchema;
    };
  }>;
};

export type AskResponse = {
  readonly choices: Choice[];
  readonly usage?: Usage;
};

export type Choice = {
  readonly finishReason?: string;
  readonly message: Message;
};

export type Message = {
  readonly role?: string;
  readonly finishReason?: string;
  readonly content: string;
  readonly toolCallId?: string;
  readonly name?: string;
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

type ApiResponse = {
  choices?: Array<{
    finish_reason?: string;
    message: {
      role?: string;
      content?: string | null;
      tool_calls?: ToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    cost?: number;
  };
};

export const ask = async (req: AskRequest): Promise<AskResponse> => {
  const { model, messages, tools } = req;
  log.info('Asking AI...');

  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const apiKey = openrouterApiKey;

  const params = {
    model,
    messages,
    tools,
    // TODO: more intelligent compression
    plugins: [{ id: 'context-compression' }],
  };
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const resp = await retry({ times: 5, backoff: (i) => 1000 * i }, () =>
    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    })
  );
  const data: ApiResponse = await resp.json();
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
        content: choice.message.content ?? '',
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
