import { Mastra } from '@mastra/core/mastra';
import { expect, it, vi } from 'vitest';
import { writeWorkflow } from '../../src/mastra/workflows/index.js';
import { planOutputSchema } from '../../src/mastra/workflows/schemas.js';

it('runs the planning and writing workflow with shared fields and multiple groups', async () => {
  const code = `export const itemSchema = { type: 'object' };
export const uniqueId = item => item.id;
export const check = async url => true;
export const run = async url => [];`;
  const inputData = {
    urls: ['https://example.test/jobs', 'https://example.test/products'],
    goal: 'Extract listings',
    itemSchema: { type: 'object' },
    modules: [],
    context: [],
    tools: [],
  };
  const plan = planOutputSchema.parse({
    ...inputData,
    report: 'Use the observed endpoints for each page type.',
    groupings: [
      {
        groupingName: 'jobs',
        groupingDescription: 'Job listings',
        urls: [inputData.urls[0]],
      },
      {
        groupingName: 'products',
        groupingDescription: 'Product listings',
        urls: [inputData.urls[1]],
      },
    ],
  });
  const planning = vi.fn().mockResolvedValue({ object: plan });
  const writing = vi.fn().mockResolvedValue({ text: code });
  const mastra = new Mastra({ workflows: { writeWorkflow }, logger: false });
  const agent = vi.spyOn(mastra, 'getAgentById').mockImplementation((id) => {
    if (id === 'planning-agent') {
      return { generate: planning } as any;
    }
    if (id === 'build-agent') {
      return {
        generate: async (_prompt: string, options: Record<string, unknown>) => {
          if (options.structuredOutput) {
            return { object: { report: 'The scraper matches the schema.', rating: 95 } };
          }

          return writing(_prompt);
        },
      } as any;
    }
    throw new Error(`Unexpected agent: ${id}`);
  });

  try {
    const run = await mastra.getWorkflowById('write-workflow').createRun();
    const result = await run.start({ inputData });
    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      throw new Error(`Workflow failed: ${result.status}`);
    }
    expect(result.result).toEqual([
      { groupingName: 'jobs', code },
      { groupingName: 'products', code },
    ]);
    expect(planning).toHaveBeenCalledOnce();
    expect(writing).toHaveBeenCalledTimes(2);
    expect(writing.mock.calls[0][0]).toContain('Job listings');
    expect(writing.mock.calls[1][0]).toContain('Product listings');
  } finally {
    agent.mockRestore();
  }
});
