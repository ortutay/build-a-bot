import { afterEach, expect, test, vi } from 'vitest';
import { ask } from '../src/core/ai.js';

afterEach(() => vi.unstubAllGlobals());

test('sends OpenAI models directly to OpenAI with the provider prefix removed', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { role: 'assistant' } }] }),
  });
  vi.stubGlobal('fetch', fetchMock);

  await ask({
    model: 'openai/gpt-5',
    messages: [{ role: 'user', content: 'Hello' }],
    tools: [],
  });

  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.openai.com/v1/chat/completions',
    expect.objectContaining({
      body: JSON.stringify({
        model: 'gpt-5',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [],
      }),
    })
  );
});

test('continues to send non-OpenAI models through OpenRouter unchanged', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { role: 'assistant' } }] }),
  });
  vi.stubGlobal('fetch', fetchMock);

  await ask({
    model: 'google/gemini-3-flash-preview',
    messages: [],
    tools: [],
  });

  expect(fetchMock).toHaveBeenCalledWith(
    'https://openrouter.ai/api/v1/chat/completions',
    expect.objectContaining({
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [],
        tools: [],
      }),
    })
  );
});
