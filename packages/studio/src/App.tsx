import { useQuery } from '@tanstack/react-query';

import { getApiHealth } from './api/client.js';

export const App = () => {
  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: getApiHealth,
  });

  const apiStatus = healthQuery.isPending
    ? 'checking'
    : healthQuery.isError
      ? 'unavailable'
      : healthQuery.data.status;

  return (
    <main>
      <h1>Build-A-Bot Studio</h1>
      <p>API status: {apiStatus}</p>
    </main>
  );
};
