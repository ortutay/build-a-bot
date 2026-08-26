const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api';

export const getApiHealth = async (): Promise<{ status: string }> => {
  const resp = await fetch(`${apiBaseUrl}/health`);

  if (!resp.ok) {
    throw new Error(`API health check failed with ${resp.status}`);
  }

  return resp.json() as Promise<{ status: string }>;
};
