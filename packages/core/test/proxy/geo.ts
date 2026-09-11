import { expect } from 'vitest';

export const geoIpUrl = 'https://ipinfo.io/json';

export const expectGeoIp = async (resp: Response): Promise<void> => {
  expect(resp.ok).toBe(true);
  await expect(resp.json()).resolves.toMatchObject({
    ip: expect.any(String),
  });
};
