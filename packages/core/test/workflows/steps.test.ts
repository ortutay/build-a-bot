import { describe, expect, it, vi } from 'vitest';
import { planStep } from '../../src/mastra/workflows/steps.js';
import { code } from '../../src/prompts/templates.js';

describe('plan step input', () => {
  it('requires the available capabilities', async () => {
    expect(
      (
        await planStep.inputSchema['~standard'].validate({
          urls: ['https://example.test'],
          goal: 'Extract the page data.',
        })
      ).issues
    ).toBeDefined();
    expect(
      (
        await planStep.inputSchema['~standard'].validate({
          urls: ['https://example.test'],
          goal: 'Extract the page data.',
          context: [],
          modules: [],
          tools: [],
        })
      ).issues
    ).toBeUndefined();
  });

  it('generates a missing item schema in the plan step', async () => {
    const generate = vi.fn().mockResolvedValue({
      object: {
        generalReport: 'Use direct HTTP requests when available.',
        groupings: [
          {
            groupingName: 'catalog-pages',
            groupingDescription: 'Catalog pages',
            urls: ['https://example.test'],
            goal: 'Extract the page data.',
            report: 'Use the catalog endpoint.',
            itemSchema: JSON.stringify({
              type: 'object',
              properties: { name: { type: 'string' } },
            }),
          },
        ],
      },
    });

    const result = await (planStep.execute as any)({
      inputData: {
        urls: ['https://example.test'],
        goal: 'Extract the page data.',
        context: [],
        modules: [],
        tools: [],
      },
      mastra: { getAgentById: () => ({ generate }) },
    });

    expect(result).toMatchObject({
      generalReport: 'Use direct HTTP requests when available.',
      groupings: [
        {
          groupingName: 'catalog-pages',
          urls: ['https://example.test/'],
          itemSchema: { type: 'object', properties: { name: { type: 'string' } } },
          report: 'Use the catalog endpoint.',
        },
      ],
    });
    expect(generate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ structuredOutput: { schema: expect.any(Object) } })
    );
  });

  it('preserves the supplied item schema in the plan step', async () => {
    const itemSchema = { type: 'object', properties: { name: { type: 'string' } } };
    const generate = vi.fn().mockResolvedValue({
      object: {
        generalReport: 'Use the detail endpoint.',
        groupings: [
          {
            groupingName: 'detail-pages',
            groupingDescription: 'Detail pages',
            urls: ['https://example.test'],
            goal: 'Extract the detail page.',
            report: 'Use the detail endpoint.',
            itemSchema: JSON.stringify(itemSchema),
          },
        ],
      },
    });

    const result = await (planStep.execute as any)({
      inputData: {
        urls: ['https://example.test'],
        goal: 'Extract the detail page.',
        itemSchema,
        context: [],
        modules: [],
        tools: [],
      },
      mastra: { getAgentById: () => ({ generate }) },
    });

    expect(result).toMatchObject({ groupings: [{ itemSchema }] });
    expect(generate).toHaveBeenCalledWith(
      expect.stringContaining(JSON.stringify(itemSchema, null, 2)),
      expect.any(Object)
    );
  });

  it('rejects a generated schema that is not JSON', async () => {
    const generate = vi.fn().mockResolvedValue({
      object: {
        generalReport: 'Use the catalog endpoint.',
        groupings: [
          {
            groupingName: 'catalog-pages',
            groupingDescription: 'Catalog pages',
            urls: ['https://example.test'],
            goal: 'Extract the page data.',
            report: 'Use the catalog endpoint.',
            itemSchema: 'not JSON',
          },
        ],
      },
    });

    await expect(
      (planStep.execute as any)({
        inputData: {
          urls: ['https://example.test'],
          goal: 'Extract the page data.',
          context: [],
          modules: [],
          tools: [],
        },
        mastra: { getAgentById: () => ({ generate }) },
      })
    ).rejects.toThrow('Generated item schema must be a JSON object');
  });

  it('delimits the item schema and separate reports in the code prompt', () => {
    const prompt = code.render({
      availableContext: '[]',
      availableModules: '[]',
      itemSchema: '{ "type": "object" }',
      generalReport: 'Use direct HTTP requests.',
      groupingName: 'catalog-pages',
      groupingUrls: '[]',
      groupingReport: 'Use the catalog endpoint.',
      toolsForCode: '<tool-instructions></tool-instructions>',
      userInput: '<user-input></user-input>',
    });

    expect(prompt).toContain('<item-schema>\n{ "type": "object" }\n</item-schema>');
    expect(prompt).toContain('<general-report>\nUse direct HTTP requests.\n</general-report>');
    expect(prompt).toContain(
      '<group-report grouping-name="catalog-pages">\nUse the catalog endpoint.\n</group-report>'
    );
  });
});
