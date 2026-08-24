import { pick } from 'radash';
import { getOrNull, hash } from '../util/index.js';
import { log } from '../logger.js';

type ResponseCacheHashInputArgs = {
  cacheBuster: string;
  prompt: unknown;
  tools: string[];
};

export const responseCacheHashInput = ({
  cacheBuster,
  prompt,
  tools,
}: ResponseCacheHashInputArgs) => ({
  cacheBuster,
  prompt: serializePromptForCache(prompt),
  tools,
});

export const serializePromptForCache = (prompt: unknown): unknown[] => {
  if (!Array.isArray(prompt)) {
    throw new Error('Expected an array prompt when generating a cache key');
  }

  // console.log('normalizedPrompt: start');

  try {
    const normalizedPrompt = prompt
      .map((message) => {
        const content = getOrNull<unknown>(message, 'content');
        if (typeof content === 'string') {
          return content;
        }

        if (Array.isArray(content)) {
          const normalized = content
            .map((part) => {
              const clean = structuredClone(
                pick({ ...(part as Record<string, unknown>) }, [
                  'toolName',
                  'input',
                  'output',
                  'type',
                  'text',
                ])
              );
              removeCacheOnlyFields(clean);
              return clean;
            })
            .sort(hashSort);

          // console.log('normalized:', JSON.stringify(normalized, null, 2));

          return normalized;
        }

        throw new Error(`Unknown message type for hashing: ${JSON.stringify(content, null, 2)}`);
      })
      .sort(hashSort);

    // console.log('normalizedPrompt:', JSON.stringify(normalizedPrompt, null, 2));

    return normalizedPrompt;
  } catch (e) {
    log.error('normalizedPrompt: error:', e);
    return [hash(Math.random)];
  }
};

export const removeCacheOnlyFields = (value: unknown): void => {
  if (Array.isArray(value)) {
    value.forEach(removeCacheOnlyFields);
    return;
  }

  if (typeof value !== 'object' || value === null) {
    return;
  }

  const record = value as Record<string, unknown>;
  delete record.instruments;

  const background = getOrNull<Record<string, unknown>>(record, '_background');
  if (background) {
    delete background.maxRetries;
  }

  const request = getOrNull<Record<string, unknown>>(record, 'request');
  if (request) {
    delete request.timestamp;
  }

  Object.values(record).forEach(removeCacheOnlyFields);
};

const hashSort = (a: unknown, b: unknown): number => hash(a).localeCompare(hash(b));
