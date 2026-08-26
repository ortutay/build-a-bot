import { BuildABot } from '@build-a-bot/core';
import express, { type Express } from 'express';

/** Creates an HTTP API backed by one configured BuildABot instance. */
export const createApi = (buildABot: BuildABot): Express => {
  const app = express();

  app.get('/api/health', (_req, resp) => {
    resp.json({ status: 'ok', buildABot: Boolean(buildABot) });
  });

  return app;
};
