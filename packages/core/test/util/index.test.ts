import { describe, expect, it } from 'vitest';
import { getOrNull } from '../../src/internal/util/index.js';

describe('getOrNull', () => {
  it('returns an object property when it exists', () => {
    expect(getOrNull<string>({ pageId: 'page-1' }, 'pageId')).toBe('page-1');
    expect(getOrNull<string>({}, 'pageId')).toBeNull();
    expect(getOrNull<string>(null, 'pageId')).toBeNull();
  });
});
