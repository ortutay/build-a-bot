import crypto from 'crypto';

export const hash = (obj) => {
  const str = typeof obj == 'string' ? obj : JSON.stringify(obj || '');
  return crypto.createHash('sha256').update(str).digest('hex');
};

export const clip = (value, max = 500) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
};
