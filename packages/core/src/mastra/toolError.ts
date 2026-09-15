import { getOrNull } from '../util/index.js';

// Mastra may return validation failures instead of rejecting execute().
export const toolError = (val: unknown): Error | null =>
  getOrNull<boolean>(val, 'error') === true || getOrNull<boolean>(val, 'isError') === true
    ? new Error(getOrNull<string>(val, 'message') ?? 'Tool execution failed')
    : null;

export const isToolFailure = (val: unknown): boolean =>
  getOrNull<boolean>(val, 'ok') === false || toolError(val) !== null;
