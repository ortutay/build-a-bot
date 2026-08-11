import crypto from 'crypto';

export const hash = (obj) => {
  const str = typeof obj == 'string' ? obj : JSON.stringify(obj || '');
  return crypto.createHash('sha256').update(str).digest('hex');
};

export const clip = (value, max = 500) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
};

export const retry = async (fn, retries = 8, pauseMs = 100) => {
  let attempt = 0;
  let resp;
  while (true) {
    try {
      resp = await fn();
      if (
        resp.status == 403 &&
        resp.url.match(/https:\/\/\w+\.s3\.amazonaws\.com/)
      ) {
        throw new Error('S3 403');
      }
      return resp;
    } catch (e) {
      attempt++;
      if (attempt >= retries) {
        throw e;
      }
      const msec = Math.round(
        attempt * pauseMs + 0.1 * Math.random() * pauseMs
      );
      console.log(
        `Pause ${msec} msec and retry fetch on ${resp?.url}, attempt #${attempt}`
      );
      await new Promise((ok) => setTimeout(ok, msec));
    }
  }
};
