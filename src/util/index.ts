import crypto from 'crypto';
import { deterministicRandom } from '../constants.js';

export const getOrNull = <Value>(input: unknown, key: string): Value | null => {
  if (typeof input !== 'object' || input === null || !(key in input)) {
    return null;
  }

  return (input as Record<string, Value | null | undefined>)[key] ?? null;
};

export const srid = (() => {
  let deterministicSeed = 0x12345678;

  return (len = 6, prefix = ''): string => {
    const alpha = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
    let id = '';
    for (let i = 0; i < len; i++) {
      if (deterministicRandom) {
        deterministicSeed ^= deterministicSeed << 13;
        deterministicSeed ^= deterministicSeed >>> 17;
        deterministicSeed ^= deterministicSeed << 5;
        id += alpha[Math.floor(((deterministicSeed >>> 0) / 0x100000000) * alpha.length)];
      } else {
        id += alpha[Math.floor(Math.random() * alpha.length)];
      }
    }

    // bullmq doesn't allow integer custom ID's, ensure at least one
    // alpha character
    const r = prefix + id;
    if (r.match(/^[0-9]+$/)) {
      return srid(len, prefix);
    } else {
      return r;
    }
  };
})();

export const hash = (obj: unknown): string => {
  const str = typeof obj === 'string' ? obj : JSON.stringify(obj || '') || '';
  return crypto.createHash('sha256').update(str).digest('hex');
};

export const clip = (value: unknown, max = 500): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value) || '';
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
};
