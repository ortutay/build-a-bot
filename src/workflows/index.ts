import { createWorkflow } from '@mastra/core/workflows';
import { fullPlanStep, writeCodeStep } from './steps.js';

export const planWorkflow = createWorkflow({
  // mastra,
  id: 'plan-workflow',
  inputSchema: fullPlanStep.inputSchema,
  outputSchema: fullPlanStep.outputSchema,
})
  .then(fullPlanStep)
  .then(writeCodeStep)
  .commit();

export const writeWorkflow = createWorkflow({
  // mastra,
  id: 'write-workflow',
  inputSchema: fullPlanStep.inputSchema,
  outputSchema: writeCodeStep.outputSchema,
})
  .then(fullPlanStep)
  .then(writeCodeStep)
  .commit();
