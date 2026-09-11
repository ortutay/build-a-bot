import { createWorkflow } from '@mastra/core/workflows';
import { planStep, writeCodeStep } from './steps.js';

export const planWorkflow = createWorkflow({
  id: 'plan-workflow',
  inputSchema: planStep.inputSchema,
  outputSchema: planStep.outputSchema,
})
  .then(planStep)
  .commit();

export const writeWorkflow = createWorkflow({
  id: 'write-workflow',
  inputSchema: planStep.inputSchema,
  outputSchema: writeCodeStep.outputSchema,
})
  .then(planStep)
  .then(writeCodeStep)
  .commit();
