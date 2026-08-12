import crypto from 'crypto';

export const hash = (obj: unknown): string => {
  const str = typeof obj === 'string' ? obj : JSON.stringify(obj || '') || '';
  return crypto.createHash('sha256').update(str).digest('hex');
};

export const clip = (value: unknown, max = 500): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value) || '';
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
};
