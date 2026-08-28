import { createWorkflow } from '@mastra/core/workflows';
import { type createPlanStepScorer } from '../scorers/index.js';
import { createPlanSteps, writeCodeStep } from './steps.js';

type PlanStepScorer = ReturnType<typeof createPlanStepScorer>;

export const createWorkflows = (planStepScorer: PlanStepScorer) => {
  const { fullPlanStep } = createPlanSteps(planStepScorer);

  const planWorkflow = createWorkflow({
    id: 'plan-workflow',
    inputSchema: fullPlanStep.inputSchema,
    outputSchema: fullPlanStep.outputSchema,
  })
    .then(fullPlanStep)
    .then(writeCodeStep)
    .commit();

  const writeWorkflow = createWorkflow({
    id: 'write-workflow',
    inputSchema: fullPlanStep.inputSchema,
    outputSchema: writeCodeStep.outputSchema,
  })
    .then(fullPlanStep)
    .then(writeCodeStep)
    .commit();

  return { planWorkflow, writeWorkflow };
};
