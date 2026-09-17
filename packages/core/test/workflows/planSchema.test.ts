import { expect, it, vi } from 'vitest';
import { planStep } from '../../src/mastra/workflows/steps.js';

it('keeps the required nested schema supplied by the caller', async () => {
  const itemSchema = {
    type: 'object',
    required: ['details'],
    properties: {
      details: {
        type: 'object',
        required: ['notes', 'fields', 'enabled'],
        properties: {
          notes: { type: ['string', 'null'] },
          fields: { type: 'array', items: { type: 'object' } },
          enabled: { type: ['boolean', 'null'] },
        },
      },
    },
  };
  const generate = vi.fn().mockResolvedValue({
    object: {
      goal: 'Extract records',
      modules: [],
      context: [],
      tools: [],
      report: 'Nested record details.',
      groupings: [
        {
          groupingName: 'records',
          groupingDescription: 'Record pages',
          urls: ['https://example.test/records'],
        },
      ],
    },
  });
  const result = await (planStep.execute as any)({
    inputData: {
      urls: ['https://example.test/records'],
      goal: 'Extract records',
      itemSchema,
      modules: [],
      context: [],
      tools: [],
    },
    mastra: { getAgentById: () => ({ generate }) },
  });
  expect(result.itemSchema).toEqual(itemSchema);
});
