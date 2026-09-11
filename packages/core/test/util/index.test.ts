import { describe, expect, it } from 'vitest';
import { getOrNull, norm } from '../../src/util/index.js';

describe('getOrNull', () => {
  it('returns an object property when it exists', () => {
    expect(getOrNull<string>({ pageId: 'page-1' }, 'pageId')).toBe('page-1');
    expect(getOrNull<string>({}, 'pageId')).toBeNull();
    expect(getOrNull<string>(null, 'pageId')).toBeNull();
  });
});

describe('norm', () => {
  it('normalizes a URL without removing its fragment', () => {
    expect(norm('https://EXAMPLE.test:443/page?q=1#section')).toBe(
      'https://example.test/page?q=1#section'
    );
  });

  it('sorts and deduplicates URLs while preserving distinct hash routes', () => {
    expect(
      norm([
        'https://example.test/#/product/2',
        'https://EXAMPLE.test:443/#/product/1',
        'https://example.test/#/product/1',
      ])
    ).toEqual(['https://example.test/#/product/1', 'https://example.test/#/product/2']);
  });
});
