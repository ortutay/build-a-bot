import { expect, it, vi } from 'vitest';
import { planStep } from '../../src/mastra/workflows/steps.js';

it('keeps the supplied nested schema even when the planner simplifies or corrupts its copy', async () => {
  const itemSchema = {
    type: 'object',
    required: ['application_structure'],
    properties: {
      application_structure: {
        type: 'object',
        required: ['notes', 'fields', 'cv_required'],
        properties: {
          notes: { type: ['string', 'null'] },
          fields: { type: 'array', items: { type: 'object' } },
          cv_required: { type: ['boolean', 'null'] },
        },
      },
    },
  };
  for (const proposed of [
    '{"type":"object","properties":{"application_structure":{"type":"object"}}}',
    'not JSON',
    null,
  ]) {
    const generate = vi.fn().mockResolvedValue({
      object: {
        generalReport: 'Application is gated.',
        groupings: [
          {
            groupingName: 'jobs',
            groupingDescription: 'Job pages',
            goal: 'Extract jobs',
            urls: ['https://example.test/jobs'],
            report: 'Fetch the observed jobs.',
            itemSchema: proposed,
          },
        ],
      },
    });
    const result = await (planStep.execute as any)({
      inputData: {
        urls: ['https://example.test/jobs'],
        goal: 'Extract jobs',
        itemSchema,
        modules: [],
        context: [],
        tools: [],
      },
      mastra: { getAgentById: () => ({ generate }) },
    });
    expect(result.groupings[0].itemSchema).toEqual(itemSchema);
  }
});
