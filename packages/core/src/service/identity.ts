import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getOrNull } from '../util/index.js';

export const identitySchema = z.object({
  fields: z
    .array(
      z.object({
        path: z.string().min(1),
        normalize: z.enum(['text', 'lowercase', 'digits', 'url', 'url-tenant']).default('text'),
      })
    )
    .min(1),
});
export type IdentityConfig = z.input<typeof identitySchema>;

export const entityId = (data: unknown, config: IdentityConfig): string => {
  const parts = config.fields.map(({ path, normalize = 'text' }) => {
    const raw = path.split('.').reduce<unknown>((val, key) => getOrNull<unknown>(val, key), data);
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      throw new Error(`Missing identity field: ${path}`);
    }
    let val = String(raw).normalize('NFKC').trim();
    if (normalize === 'lowercase') {
      val = val.toLowerCase();
    }
    if (normalize === 'digits') {
      val = val.replace(/\D/g, '');
    }
    if (normalize === 'url' || normalize === 'url-tenant') {
      const url = new URL(val);
      url.hash = '';
      url.search = '';
      const segment = url.pathname.split('/').filter(Boolean)[0] ?? '';
      val =
        normalize === 'url'
          ? url.href
          : `${url.hostname.toLowerCase()}/${/^[a-z]{2}-[a-z]{2}$/i.test(segment) ? '' : segment}`;
    }
    if (!val) {
      throw new Error(`Empty identity field: ${path}`);
    }
    return val;
  });
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
};
