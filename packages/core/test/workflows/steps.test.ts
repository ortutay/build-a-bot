import { describe, expect, it, vi } from 'vitest';
import { planStep } from '../../src/mastra/workflows/steps.js';
import { code } from '../../src/prompts/templates.js';

describe('plan step input', () => {
  it('requires the available capabilities', () => {
    expect(
      planStep.inputSchema.safeParse({
        urls: ['https://example.test'],
        goal: 'Extract the page data.',
      }).success
    ).toBe(false);
    expect(
      planStep.inputSchema.safeParse({
        urls: ['https://example.test'],
        goal: 'Extract the page data.',
        context: [],
        modules: [],
        tools: [],
      }).success
    ).toBe(true);
  });

  it('generates missing schemas in the plan step', async () => {
    const generate = vi.fn().mockResolvedValue({
      object: {
        generalReport: 'Use direct HTTP requests when available.',
        groupings: [
          {
            grouping: 'Catalog pages',
            urls: ['https://example.test'],
            goal: 'Extract the page data.',
            report: 'Use the catalog endpoint.',
            inputSchema: JSON.stringify({
              type: 'object',
              properties: { query: { type: 'string' } },
            }),
            outputSchema: JSON.stringify({ type: 'array', items: { type: 'string' } }),
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
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          outputSchema: { type: 'array', items: { type: 'string' } },
          report: 'Use the catalog endpoint.',
        },
      ],
    });
    expect(generate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ structuredOutput: { schema: expect.any(Object) } })
    );
  });

  it('preserves supplied schemas in the plan step', async () => {
    const inputSchema = { type: 'object', properties: { id: { type: 'string' } } };
    const outputSchema = { type: 'object', properties: { name: { type: 'string' } } };
    const generate = vi.fn().mockResolvedValue({
      object: {
        generalReport: 'Use the detail endpoint.',
        groupings: [
          {
            grouping: 'Detail pages',
            urls: ['https://example.test'],
            goal: 'Extract the detail page.',
            report: 'Use the detail endpoint.',
            inputSchema: JSON.stringify(inputSchema),
            outputSchema: JSON.stringify(outputSchema),
          },
        ],
      },
    });

    const result = await (planStep.execute as any)({
      inputData: {
        urls: ['https://example.test'],
        goal: 'Extract the detail page.',
        inputSchema,
        outputSchema,
        context: [],
        modules: [],
        tools: [],
      },
      mastra: { getAgentById: () => ({ generate }) },
    });

    expect(result).toMatchObject({ groupings: [{ inputSchema, outputSchema }] });
  });

  it('rejects a generated schema that is not JSON', async () => {
    const generate = vi.fn().mockResolvedValue({
      object: {
        generalReport: 'Use the catalog endpoint.',
        groupings: [
          {
            grouping: 'Catalog pages',
            urls: ['https://example.test'],
            goal: 'Extract the page data.',
            report: 'Use the catalog endpoint.',
            inputSchema: 'not JSON',
            outputSchema: JSON.stringify({ type: 'array' }),
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
    ).rejects.toThrow('Generated input schema must be a JSON object');
  });

  it('delimits schemas in the code prompt', () => {
    const prompt = code.render({
      availableContext: '[]',
      availableModules: '[]',
      inputSchema: '{ "type": "object" }',
      outputSchema: '{ "type": "array" }',
      report: '<report>Use the catalog endpoint.</report>',
      toolsForCode: '<tool-instructions></tool-instructions>',
      userInput: '<user-input></user-input>',
    });

    expect(prompt).toContain('<input-schema>\n{ "type": "object" }\n</input-schema>');
    expect(prompt).toContain('<output-schema>\n{ "type": "array" }\n</output-schema>');
  });
});
