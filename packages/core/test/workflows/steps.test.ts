import { describe, expect, it } from 'vitest';
import { writeWorkflowInputSchema } from '../../src/internal/mastra/workflows/steps.js';

describe('write workflow input', () => {
  it('requires the available capabilities', () => {
    expect(
      writeWorkflowInputSchema.safeParse({
        url: 'https://example.test',
        goal: 'Extract the page data.',
      }).success
    ).toBe(false);
    expect(
      writeWorkflowInputSchema.safeParse({
        url: 'https://example.test',
        goal: 'Extract the page data.',
        context: [],
        modules: [],
        tools: [],
      }).success
    ).toBe(true);
  });
});
