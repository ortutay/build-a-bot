import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DataService } from '@build-a-bot/core';

// Keep service names stable across processes so build() reuses persisted scripts.
// Every invocation repeats build/sync/list three times and retains full evidence.

export const exercise = async (service: DataService, minItems = 0): Promise<boolean> => {
  const dir = resolve(
    '.log/beta-workflows',
    service.name,
    new Date().toISOString().replaceAll(':', '-')
  );
  await mkdir(dir, { recursive: true });
  let previous: string | undefined;
  let ok = true;
  for (let i = 1; i <= 3; i++) {
    const started = Date.now();
    try {
      const changes = await service.start();
      const builtAt = Date.now();
      const syncedAt = Date.now();
      const listed = await service.list({ limit: 100 });
      for (let page = 2; listed.results.length < listed.total; page++) {
        const next = await service.list({ limit: 100, page });
        if (next.count === 0) {
          throw new Error('Pagination ended before list().total');
        }
        listed.results.push(...next.results);
      }
      listed.count = listed.results.length;
      const fingerprint = createHash('sha256').update(JSON.stringify(listed.results)).digest('hex');
      const forms = listed.results
        .map((item) => (item as Record<string, any>).application_structure)
        .filter(Boolean);
      const quality = {
        complete: forms.filter((form) => form.status === 'complete').length,
        partial: forms.filter((form) => form.status === 'partial').length,
        unavailable: forms.filter((form) => form.status === 'unavailable' || !form.fields?.length)
          .length,
      };
      const summary = {
        quality,
        service: service.name,
        iteration: i,
        elapsedMs: Date.now() - started,
        buildMs: builtAt - started,
        syncMs: syncedAt - builtAt,
        listMs: Date.now() - syncedAt,
        total: listed.total,
        created: changes.created.length,
        updated: changes.updated.length,
        outcome: {
          success: changes.outcome.success.length,
          unhandled: changes.outcome.unhandled.length,
          errors: changes.outcome.errors.length,
        },
        fingerprint,
        unchanged: previous === undefined ? null : previous === fingerprint,
        meetsMinimum: listed.total >= minItems,
      };
      await writeFile(
        resolve(dir, `run-${i}.json`),
        JSON.stringify({ summary, changes, listed }, null, 2)
      );
      console.log('BETA_RESULT', JSON.stringify(summary));
      console.log('BETA_ITEMS', JSON.stringify(listed.results, null, 2));
      if (
        !summary.meetsMinimum ||
        summary.outcome.errors ||
        summary.outcome.unhandled ||
        quality.partial ||
        quality.unavailable
      ) {
        ok = false;
        console.error(
          'BETA_INCOMPLETE',
          service.name,
          `Expected successful syncs, at least ${minItems} items and complete application structures; outcome=${JSON.stringify(summary.outcome)}, quality=${JSON.stringify(quality)}`
        );
      }
      previous = fingerprint;
    } catch (e) {
      ok = false;
      const error =
        e instanceof Error
          ? { name: e.name, message: e.message, stack: e.stack }
          : { message: String(e) };
      const listed = await service.list().catch(() => null);
      await writeFile(
        resolve(dir, `run-${i}.json`),
        JSON.stringify({ service: service.name, iteration: i, error, listed }, null, 2)
      );
      console.error('BETA_ERROR', service.name, i, error);
    }
  }
  console.log('BETA_ARTIFACTS', dir);
  return ok;
};
