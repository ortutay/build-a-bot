import crypto from 'crypto';

export const srid = (len = 6, prefix = ''): string => {
  const alpha = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
  let id = '';
  for (let i = 0; i < len; i++) {
    id += alpha[Math.floor(Math.random() * alpha.length)];
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

export const hash = (obj: unknown): string => {
  const str = typeof obj === 'string' ? obj : JSON.stringify(obj || '') || '';
  return crypto.createHash('sha256').update(str).digest('hex');
};

export const clip = (value: unknown, max = 500): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value) || '';
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
};
