import { z } from 'zod';

export const jsonSchema = z.record(z.string(), z.unknown());

export const planInputSchema = z.object({
  urls: z.array(z.string()),
  goal: z.string(),
  itemSchema: jsonSchema,
  modules: z.array(z.string()),
  context: z.array(z.string()),
  tools: z.array(z.string()),
});

export const planOutputSchema = z.object({
  goal: z.string(),
  itemSchema: jsonSchema,
  modules: z.array(z.string()),
  context: z.array(z.string()),
  tools: z.array(z.string()),
  report: z.string().describe('Implementation plan and report'),

  groupings: z
    .array(
      z.object({
        groupingName: z.string().describe('Short unique name of this grouping, kebab-case'),
        groupingDescription: z.string().describe('Description of this grouping'),
        urls: z.array(z.string()).describe('URLs that this grouping applies to'),
      })
    )
    .min(1),
});

// The caller supplies the item schema, so the planner does not return it.
export const planAgentOutputSchema = planOutputSchema.omit({ itemSchema: true });

export const groupingWriteCodeInputSchema = z.object({
  goal: z.string(),
  itemSchema: jsonSchema,
  modules: z.array(z.string()),
  context: z.array(z.string()),
  tools: z.array(z.string()),
  report: z.string().describe('Implementation plan and report'),
  grouping: z.object({
    groupingName: z.string().describe('Short unique name of this grouping, kebab-case'),
    groupingDescription: z.string().describe('Description of this grouping'),
    urls: z.array(z.string()).describe('URLs that this grouping applies to'),
  }),
});

export const codeEvaluationOutputSchema = z.object({
  report: z.string().describe('Report on the generated code, which is passed in as a tool.'),
  rating: z
    .number()
    .min(1)
    .max(100)
    .describe('Rating on a scale of 1 to 100, where 100 is perfect, of how good the script is'),
});

export const writeCodeStepOutputschema = z.object({
  groupingName: z.string(),
  code: z.string(),
});

export const healInputSchema = z.object({
  goal: z.string(),
  code: z.string(),
  urls: z.array(z.string()),
  itemSchema: jsonSchema,
  modules: z.array(z.string()),
  context: z.array(z.string()),
  tools: z.array(z.string()),
});

const healResultSchema = z.object({
  report: z
    .string()
    .describe(
      'Describe the code quality, and issues you saw, and anything that needs tobe improved, or that is working well. Focus on robustness of the code for handling potentially varied pages within the target class of URLs, and also on correctness of the data returned.'
    ),
  rating: z
    .number()
    .min(1)
    .max(100)
    .describe('An overall rating of the code, where 100 is perfect, and 1 is completely unusable.'),
  noChanges: z
    .boolean()
    .describe(
      'If true, the original code was corrected, and no changes are needed. If true, code should be null. If false, code should return different code than what you received. Generally, if the code is correctly handling pages, returning the proper format in a timely fashion, then no changes are needed. If is faulty, throwing errors, or returning inaccurate data where it could be returning proper data, then changes are needed. Do not request changes if the task is not possible to complete.'
    ),
});

export const healAgentOutputSchema = healResultSchema.extend({
  code: z.string().nullable(),
});

export const healOutputSchema = healResultSchema.extend({
  shouldSave: z.boolean().describe('Whether code or dependency changes need to be persisted.'),
  code: z.string().nullable(),
  context: z.array(z.string()),
  modules: z.array(z.string()),
  tools: z.array(z.string()),
});
