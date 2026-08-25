import { omit } from 'radash';
import chalk from 'chalk';
import { log } from '../logger.js';
import { clip } from '../util/index.js';
import {
  ResponseCache,
  type ProcessLLMRequestArgs,
  type ProcessLLMResponseArgs,
  type ProcessLLMRequestResult,
  type Processor,
  type ResponseCacheOptions,
} from '@mastra/core/processors';

const prettyArg = (value: unknown): string => clip(formatArg(value, new Set()));

const formatArg = (value: unknown, ancestors: Set<object>): string => {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
    case 'boolean':
      return String(value);
    case 'bigint':
      return `${value}n`;
    case 'undefined':
    case 'symbol':
    case 'function':
      return String(value);
  }

  const objectValue = value as Record<string, unknown>;
  if (ancestors.has(objectValue)) {
    return '[Circular]';
  }

  ancestors.add(objectValue);
  try {
    if (Array.isArray(objectValue)) {
      return `[${objectValue.map((item) => formatArg(item, ancestors)).join(', ')}]`;
    }

    return `{ ${Object.keys(objectValue)
      .map((key) => `${chalk.greenBright(key)}: ${formatArg(objectValue[key], ancestors)}`)
      .join(', ')} }`;
  } catch (e) {
    return '[Uninspectable]';
  } finally {
    ancestors.delete(objectValue);
  }
};

export class ResponseLoggingProcessor implements Processor<'response-logging'> {
  readonly id = 'response-logging';
  readonly name = 'Response Logging';

  processLLMResponse(args: ProcessLLMResponseArgs) {
    this.logResponse(args);
  }

  logResponse({
    stepNumber,
    model,
    chunks,
    fromCache,
  }: Pick<
    ProcessLLMResponseArgs,
    'stepNumber' | 'model' | 'rawResponse' | 'chunks' | 'fromCache'
  >) {
    log.info(`${chalk.bold.black.bgYellowBright('AI STEP ' + stepNumber)}`);

    if (fromCache) {
      log.info(`${chalk.bold('[cache hit]')} step=${stepNumber} model=${model.modelId}`);
    } else {
      log.info(
        `${chalk.bold.yellowBright('[cache miss]')} step=${stepNumber} model=${model.modelId}`
      );
    }

    const toolCalls = chunks
      .filter((chunk) => chunk.type === 'tool-call')
      .map((chunk) => chunk.payload);

    for (const toolCall of toolCalls) {
      const { toolName, args } = toolCall as { toolName: string; args: Record<string, unknown> };
      log.info(`${chalk.bold.cyanBright(toolName)} ${prettyArg(omit(args, ['_background']))}`);
    }
  }

  private textFromPayload(payload: unknown): string | undefined {
    if (typeof payload !== 'object' || payload === null || !('text' in payload)) {
      return undefined;
    }

    return typeof payload.text === 'string' ? payload.text : undefined;
  }
}

export class LoggingResponseCache extends ResponseCache {
  constructor(
    options: ResponseCacheOptions,
    private readonly responseLogger: ResponseLoggingProcessor
  ) {
    super(options);
  }

  async processLLMRequest(args: ProcessLLMRequestArgs): Promise<ProcessLLMRequestResult> {
    const result = await super.processLLMRequest(args);

    if (result?.response) {
      this.responseLogger.logResponse({
        stepNumber: args.stepNumber,
        model: args.model,
        chunks: result.response.chunks,
        rawResponse: result.response.rawResponse,
        fromCache: true,
      });
    }

    return result;
  }
}
