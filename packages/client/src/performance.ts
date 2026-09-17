import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { DataService, DataSource } from '@build-a-bot/core';
import { createClientContext } from './timo/proxies.js';

type Case = {
  itemSchema: Record<string, unknown>;
  identity: ConstructorParameters<typeof DataService>[0]['identity'];
  urls: string[];
  syncUrls?: string[];
};
const [
  name = 'jobs',
  configPath = new URL('../reports/PERFORMANCE-20260915-CASES.json', import.meta.url).pathname,
] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const syncOnly = process.argv.includes('--sync-only');
const label = process.argv.find((arg) => arg.startsWith('--label='))?.slice(8) ?? name;
const excludedHost = process.argv.find((arg) => arg.startsWith('--exclude-host='))?.slice(15);
const cases: Record<string, Case> = JSON.parse(await readFile(configPath, 'utf8'));
const config = cases[name];
if (!config) {
  throw new Error(`Unknown comparison case: ${name}`);
}
const dir = resolve('.log/performance', label);
await mkdir(dir, { recursive: true });
const phase = async (stage: string, iteration = 0) => {
  const state = { stage, iteration, timestamp: new Date().toISOString() };
  await writeFile(resolve(dir, 'phase.json'), JSON.stringify(state));
  console.log('PERFORMANCE_PHASE', JSON.stringify(state));
};
const stable = (val: unknown): unknown => {
  if (Array.isArray(val)) {
    return val.map(stable);
  }
  if (val && typeof val === 'object') {
    return Object.fromEntries(
      Object.entries(val)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)])
    );
  }
  return val;
};
await phase('setup');
const started = Date.now();
const service = new DataService({
  name: `performance-${name}`,
  context: await createClientContext(),
  itemSchema: config.itemSchema,
  identity: config.identity,
  sources: config.urls.map((url) => new DataSource({ url })),
});
const setupMs = Date.now() - started;
const urls = (config.syncUrls ?? config.urls).filter(
  (url) => new URL(url).hostname !== excludedHost
);
let previous: string | undefined;
let ok = true;
for (let iteration = 1; iteration <= 3; iteration++) {
  const timing: Record<string, number> = { setupMs };
  let stage = 'build';
  let stageStarted = Date.now();
  try {
    await phase(stage, iteration);
    if (!syncOnly) {
      await service.build();
    }
    timing.buildMs = Date.now() - stageStarted;
    stage = 'sync';
    await phase(stage, iteration);
    stageStarted = Date.now();
    const changes = await service.sync(urls);
    timing.syncMs = Date.now() - stageStarted;
    stage = 'list';
    await phase(stage, iteration);
    stageStarted = Date.now();
    const listed = await service.list({ limit: 100 });
    for (let page = 2; listed.results.length < listed.total; page++) {
      const next = await service.list({ limit: 100, page });
      if (!next.count) {
        throw new Error('Pagination ended before total');
      }
      listed.results.push(...next.results);
    }
    timing.listMs = Date.now() - stageStarted;
    const items = listed.results as Record<string, any>[];
    const content = items.map((item) => JSON.stringify(stable(item))).sort();
    const fingerprint = createHash('sha256').update(JSON.stringify(content)).digest('hex');
    const outcome = changes.outcome as unknown as {
      success: { url: string }[];
      unhandled: { url: string }[];
      errors?: { url: string; error: string }[];
      error?: { url: string; error: string }[];
    };
    const errors = outcome.errors ?? outcome.error ?? [];
    const byAts: Record<string, number> = {};
    const forms: Record<string, number> = {};
    for (const item of items) {
      if (item.ats_platform) {
        byAts[item.ats_platform] = (byAts[item.ats_platform] ?? 0) + 1;
      }
      if (item.application_structure) {
        const status = item.application_structure.status;
        forms[status] = (forms[status] ?? 0) + 1;
      }
    }
    const summary = {
      name,
      syncOnly,
      urls,
      iteration,
      ...timing,
      total: listed.total,
      distinctIdentities: new Set(items.map((item) => item.id)).size,
      created: changes.created.length,
      updated: changes.updated.length,
      success: outcome.success.length,
      unhandled: outcome.unhandled.length,
      errors,
      byAts,
      forms,
      fingerprint,
      unchanged: previous === undefined ? null : previous === fingerprint,
    };
    await writeFile(
      resolve(dir, `run-${iteration}.json`),
      JSON.stringify({ summary, changes, listed }, null, 2)
    );
    console.log('PERFORMANCE_RESULT', JSON.stringify(summary));
    previous = fingerprint;
    if (errors.length || outcome.unhandled.length || !listed.total) {
      ok = false;
    }
  } catch (e) {
    const failure = {
      name,
      syncOnly,
      urls,
      iteration,
      stage,
      ...timing,
      stageMs: Date.now() - stageStarted,
      error: e instanceof Error ? e.message : String(e),
    };
    await writeFile(resolve(dir, `run-${iteration}.json`), JSON.stringify(failure, null, 2));
    console.error('PERFORMANCE_ERROR', JSON.stringify(failure));
    ok = false;
    break;
  }
}
await phase('done');
process.exit(ok ? 0 : 1);
