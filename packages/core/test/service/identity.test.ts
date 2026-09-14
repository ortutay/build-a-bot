import { expect, it } from 'vitest';
import { entityId } from '../../src/service/identity.js';

it('normalizes Swedish organisation identity while ignoring mutable facts', () => {
  const config = { fields: [{ path: 'org', normalize: 'digits' as const }] };
  expect(entityId({ org: '556074-3089', revenue: 1 }, config)).toBe(
    entityId({ org: '5560743089', revenue: 2 }, config)
  );
  expect(() => entityId({ org: null }, config)).toThrow('Missing identity');
});
it('separates ATS tenants and keeps posting identity independent of slugs', () => {
  const config = {
    fields: [{ path: 'url', normalize: 'url-tenant' as const }, { path: 'external_id' }],
  };
  expect(
    entityId({ url: 'https://jobs.ashbyhq.com/a/old?tracking=1', external_id: 'one' }, config)
  ).toBe(entityId({ url: 'https://jobs.ashbyhq.com/a/new', external_id: 'one' }, config));
  expect(entityId({ url: 'https://jobs.ashbyhq.com/b/old', external_id: 'one' }, config)).not.toBe(
    entityId({ url: 'https://jobs.ashbyhq.com/a/old', external_id: 'one' }, config)
  );
});
