import { expect, it } from 'vitest';
import { Compiler } from '../../src/compile/Compiler.js';

it('shares a twenty-starts-per-second budget across concurrent script runs', async () => {
  const starts: number[] = [];
  const script = await new Compiler().compile(
    `
    export const itemSchema = { type: 'object' };
    export const uniqueId = () => 'item';
    export const check = async () => true;
    export const run = async () => {
      await Promise.all(Array.from({ length: 11 }, () => pq.add(() => record())));
      return [];
    };
  `,
    {
      additionalContext: {
        record: () => {
          starts.push(Date.now());
        },
      },
    }
  );
  await Promise.all([script.run('https://example.test/a'), script.run('https://example.test/b')]);
  expect(starts).toHaveLength(22);
  expect(starts[19] - starts[0]).toBeLessThan(1000);
  expect(starts[20] - starts[0]).toBeGreaterThanOrEqual(990);
});
