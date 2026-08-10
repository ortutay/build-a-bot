import { retryFetch } from './fetchers';
import { openaiApiKey, openrouterApiKey } from './constants';

export const ask = async ({ model, messages, tools }) => {
  console.log('Asking AI...');

  const isOpenAI = false; //model.startsWith('openai/');

  const url = isOpenAI
    ? 'https://api.openai.com/v1/chat/completions'
    : 'https://openrouter.ai/api/v1/chat/completions';

  const apiKey = isOpenAI ? openaiApiKey : openrouterApiKey;
  const providerModel = isOpenAI ? model.slice('openai/'.length) : model;

  const params = {
    model: providerModel,
    messages,
    tools,
    // TODO: more intelligent compression
    plugins: [{ id: 'context-compression' }],
  };
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // console.log(body);
  const resp = await retryFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await resp.json();
  console.log('AI responded, OK:', resp.ok);

  if (!resp.ok) {
    throw new Error(
      `AI request failed (${resp.status}): ${JSON.stringify(data)}`
    );
  }
  if (!data.choices?.[0]?.message) {
    throw new Error(
      `AI returned no assistant message: ${JSON.stringify(data)}`
    );
  }

  return data;
};
