import * as z from 'zod';

export type BuildOptions = {
  url: string;
  prompt: string;
  inputSchema?: z.ZodType;
  outputSchema?: any;
};
