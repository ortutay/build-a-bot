import { describe, it, expect, afterAll } from 'vitest';
import { runEvals } from '@mastra/core/evals';
import { writeWorkflow } from '../src/workflows/index.js';
import { cleanup } from '../src/mastra/index.js';
import { loadDataset, loadItemsFromDataset } from '../src/mastra/datasets/index.js';
import { buildScorer } from '../src/scorers/index.js';
import { log } from '../src/logger.js';
import {
  pokemonTarget,
  northeastTarget,
  yelmofficeTarget,
  realEstateTargets,
  realEstateTopLevelTargets,
} from './targets.js';

describe('full evals', () => {
  const runTarget = async (target: any) => {
    const workflow = writeWorkflow;
    await runEvals({
      target: workflow,
      data: [
        {
          input: {
            url: target.url,
            goal: target.prompt,
            inputSchema: target.inputSchema,
            exampleInput: target.exampleInput,
          },
        },
      ],
      scorers: {
        workflow: [buildScorer],
      },
      onItemComplete: ({ item, scorerResults }) => {
        console.log(`Workflow completed for:`, item);
        if (scorerResults.workflow) {
          for (const key of Object.keys(scorerResults.workflow)) {
            console.log('Score:', key, scorerResults.workflow[key].score);
            console.log('Analysis:', key, scorerResults.workflow[key].analyzeStepResult);
          }
        }
      },
    });
  };

  afterAll(async () => {
    await cleanup();
  });

  it('should build and scrape pokemon', async () => {
    await runTarget(pokemonTarget);
  }, 180_000);

  it('should build and scrape northeast', async () => {
    await runTarget(northeastTarget);
  }, 180_000);

  it('should build and scrape yelmoffice', async () => {
    await runTarget(yelmofficeTarget);
  }, 180_000);

  for (const target of realEstateTargets) {
    it(`should build and scrape ${target.url} @real-estate`, async () => {
      await runTarget(target);
    }, 180_000);
  }

  for (const target of realEstateTopLevelTargets) {
    it(`should build and scrape ${target.url} @top-level-real-estate`, async () => {
      await runTarget(target);
    }, 180_000);
  }

  for (const name of ['basic', 'real-estate'] as const) {
    it(
      `evaluates every ${name} dataset item`,
      async () => {
        const items = await loadItemsFromDataset(name, { limit: 100 });
        const dataset = await loadDataset(name);
        const experiment = await dataset.createExperiment({
          name: `${name}-write-workflow`,
          targetType: 'workflow',
          targetId: writeWorkflow.id,
          scorers: [buildScorer.id],
        });

        for (const item of items) {
          const itemId = item.id;
          log.info(`Running ${itemId}: ${JSON.stringify(item.input)}`);
          const { result, scores } = await dataset.runExperimentItem({
            experimentId: experiment.experimentId,
            itemId,
          });

          log.info(
            `Result: ${JSON.stringify({ itemId: result.itemId, error: result.error, retryCount: result.retryCount })}`
          );
          log.info(
            `Scores: ${JSON.stringify(
              scores.map(({ scorerId, scorerName, score, reason, error }) => ({
                scorerId,
                scorerName,
                score,
                reason,
                error,
              }))
            )}`
          );
        }

        const summary = await dataset.finalizeExperiment({ experimentId: experiment.experimentId });
        log.info(
          `Experiment summary: ${JSON.stringify({
            experimentId: summary.id,
            status: summary.status,
            totalItems: summary.totalItems,
            succeededCount: summary.succeededCount,
            failedCount: summary.failedCount,
            skippedCount: summary.skippedCount,
          })}`
        );
      },
      30 * 60_000
    );

    it(
      `evaluates the entire ${name} dataset`,
      async () => {
        const dataset = await loadDataset(name);
        const summary = await dataset.startExperiment({
          name: `${name}-write-workflow`,
          targetType: 'workflow',
          targetId: writeWorkflow.id,
          scorers: {
            workflow: [buildScorer],
          },
          maxConcurrency: 4,
          itemTimeout: 180_000,
        });

        log.info(
          `Experiment summary: ${JSON.stringify({
            experimentId: summary.experimentId,
            status: summary.status,
            totalItems: summary.totalItems,
            succeededCount: summary.succeededCount,
            failedCount: summary.failedCount,
            skippedCount: summary.skippedCount,
            completedWithErrors: summary.completedWithErrors,
          })}`
        );
      },
      30 * 60_000
    );
  }
});
