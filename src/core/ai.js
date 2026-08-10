const openrouterApiKey = process.env.OPENROUTER_API_KEY;

export const ask = async ({ model, messages, tools }) => {
  console.log('Asking AI...');
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openrouterApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, tools }),
  });
  const data = await resp.json();

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
