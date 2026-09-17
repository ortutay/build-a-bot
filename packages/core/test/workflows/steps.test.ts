import { createTool } from '@mastra/core/tools';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { planAgentOutputSchema, planOutputSchema } from '../../src/mastra/workflows/schemas.js';
import { planStep, toolsJsonForPrompt } from '../../src/mastra/workflows/steps.js';
import { code } from '../../src/prompts/templates.js';

const inputData = {
  urls: ['https://example.test'],
  goal: 'Extract the page data.',
  itemSchema: { type: 'object', properties: { name: { type: 'string' } } },
  context: ['URL'],
  modules: ['cheerio'],
  tools: ['fetchTool'],
};
const planObject = {
  ...inputData,
  report: 'Use the catalog endpoint.',
  groupings: [
    {
      groupingName: 'catalog-pages',
      groupingDescription: 'Catalog pages',
      urls: inputData.urls,
    },
  ],
};
const { itemSchema, ...agentPlanObject } = planObject;

const execute = (generate: ReturnType<typeof vi.fn>) =>
  (planStep.execute as any)({
    inputData,
    mastra: { getAgentById: () => ({ generate }) },
  });

describe('plan step', () => {
  it('serializes tool contracts without Zod internals', () => {
    const tool = createTool({
      id: 'weatherTool',
      description: 'Look up current weather for a city.',
      inputSchema: z.object({
        city: z.string().describe('City and region to look up.'),
        units: z.enum(['celsius', 'fahrenheit']).optional(),
      }),
      outputSchema: z.object({ temperature: z.number(), condition: z.string() }),
      execute: async () => ({ temperature: 20, condition: 'sunny' }),
    });

    const tools = JSON.parse(toolsJsonForPrompt({ weatherTool: tool }));

    expect(tools).toEqual({
      weatherTool: {
        description: 'Look up current weather for a city.',
        inputSchema: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'City and region to look up.' },
            units: { type: 'string', enum: ['celsius', 'fahrenheit'] },
          },
          required: ['city'],
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: {
            temperature: { type: 'number' },
            condition: { type: 'string' },
          },
          required: ['temperature', 'condition'],
          additionalProperties: false,
        },
      },
    });
    expect(JSON.stringify(tools)).not.toContain('"def"');
    expect(JSON.stringify(tools)).not.toContain('"$schema"');
  });

  it('requires the available capabilities', async () => {
    expect(
      (
        await planStep.inputSchema['~standard'].validate({
          urls: inputData.urls,
          goal: inputData.goal,
        })
      ).issues
    ).toBeDefined();
    expect((await planStep.inputSchema['~standard'].validate(inputData)).issues).toBeUndefined();
  });

  it('uses the caller-supplied item schema', async () => {
    const generate = vi.fn().mockResolvedValue({ object: agentPlanObject });
    expect(await execute(generate)).toEqual(planOutputSchema.parse(planObject));
    expect(generate).toHaveBeenCalledWith(
      expect.stringContaining('The supplied item schema is authoritative'),
      expect.objectContaining({ structuredOutput: { schema: planAgentOutputSchema } })
    );
    for (const name of [...inputData.context, ...inputData.modules, ...inputData.tools]) {
      expect(generate.mock.calls[0][0]).toContain(name);
    }
  });

  it('does not accept an omitted item schema', async () => {
    const { itemSchema: unused, ...missingItemSchema } = inputData;
    expect(
      (await planStep.inputSchema['~standard'].validate(missingItemSchema)).issues
    ).toBeDefined();
  });

  it('includes the caller-supplied item schema in the planning prompt', async () => {
    const generate = vi.fn().mockResolvedValue({ object: agentPlanObject });
    const result = await execute(generate);
    expect(result.itemSchema).toEqual(itemSchema);
    expect(generate).toHaveBeenCalledWith(
      expect.stringContaining(JSON.stringify(itemSchema, null, 2)),
      expect.any(Object)
    );
  });

  it('preserves the caller goal and capabilities when the model changes them', async () => {
    const generate = vi.fn().mockResolvedValue({
      object: {
        ...agentPlanObject,
        goal: 'A different goal',
        modules: ['missing'],
        context: [],
        tools: ['unrequestedTool'],
      },
    });
    const { urls, ...shared } = inputData;
    expect(await execute(generate)).toMatchObject(shared);
  });

  it('uses no unsupported dynamic-key schema in the planner response format', () => {
    const schema = z.toJSONSchema(planAgentOutputSchema);
    expect(JSON.stringify(schema)).not.toContain('propertyNames');
    expect(schema.properties).not.toHaveProperty('itemSchema');
  });

  it('delimits the item schema, shared report, and grouping description in the code prompt', () => {
    const prompt = code.render({
      availableContext: '[]',
      availableModules: '[]',
      itemSchema: '{ "type": "object" }',
      report: 'Use direct HTTP requests.',
      groupingName: 'catalog-pages',
      groupingUrls: '[]',
      groupingDescription: 'Catalog pages use the catalog endpoint.',
      toolsForCode: '<tool-instructions></tool-instructions>',
      userInput: '<user-input></user-input>',
    });

    expect(prompt).toContain('<item-schema>\n{ "type": "object" }\n</item-schema>');
    expect(prompt).toContain('<report>\nUse direct HTTP requests.\n</report>');
    expect(prompt).toContain(
      '<grouping-description>\nCatalog pages use the catalog endpoint.\n</grouping-description>'
    );
  });
});
