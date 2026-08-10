import { hash } from './util';

const openrouterApiKey = process.env.OPENROUTER_API_KEY;

export const ask = async ({ model, messages, tools }) => {
  console.log('Asking AI...');

  // TODO: cache based on key of model, messages, tools
  // write cache.js, make it a disk based cache that stores items in a temporary directory
  // no expiration, rely on filesystem

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openrouterApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, tools }),
  });
  const data = await resp.json();

  console.log('AI responded', resp.ok);

  if (!resp.ok) {
    throw new Error(
      `OpenRouter request failed (${resp.status}): ${JSON.stringify(data)}`
    );
  }
  if (!data.choices?.[0]?.message) {
    throw new Error(
      `OpenRouter returned no assistant message: ${JSON.stringify(data)}`
    );
  }

  return data;
};
