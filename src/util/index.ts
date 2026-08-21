import crypto from 'crypto';
import { Reader } from 'protobufjs/minimal.js';
import { deterministicRandom } from '../constants.js';
import { log } from '../logger.js';

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

const protobufFields = (bytes: Uint8Array): number[] => {
  const reader = Reader.create(bytes);
  const fields: number[] = [];
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    if (field === 0) throw new Error('Invalid protobuf field number');
    fields.push(field);
    reader.skipType(tag & 7);
  }
  return fields;
};

export const parseResponseBody = (
  contentType: string | null | undefined,
  body: Uint8Array | ArrayBuffer
): string => {
  const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : body;
  const text = Buffer.from(bytes).toString('utf8');
  if (contentType !== 'application/json+protobuf') return text;
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {}
  try {
    return JSON.stringify({
      $protobuf: Buffer.from(bytes).toString('base64'),
      $fields: protobufFields(bytes),
    });
  } catch (e) {
    log.warn(`Could not parse protobuf response: ${String(e)}; saving base64 content`);
    return Buffer.from(bytes).toString('base64');
  }
};
