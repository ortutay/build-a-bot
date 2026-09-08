import { describe, expect, it } from 'vitest';
import { parseResponseBody } from '../../src/util/index.js';

describe('parseResponseBody', () => {
  it('summarizes wire-format payloads without a schema', () => {
    expect(
      JSON.parse(parseResponseBody('application/json+protobuf', Buffer.from([0x08, 0x96, 0x01])))
    ).toEqual({
      $protobuf: 'CJYB',
      $fields: [1],
    });
  });

  it('preserves JSON payloads sent with the protobuf media type', () => {
    expect(parseResponseBody('application/json+protobuf', Buffer.from('{"ok":true}'))).toBe(
      '{"ok":true}'
    );
  });

  it('accepts a missing content type', () => {
    expect(parseResponseBody(null, Buffer.from('plain text'))).toBe('plain text');
  });
});
