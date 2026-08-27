export type Url = string & { readonly __brand: 'Url' };
export type Domain = string & { readonly __brand: 'Domain' };

export const parseUrl = (val: string): Url => {
  try {
    new URL(val);
  } catch (e) {
    throw new TypeError(`Invalid URL: ${val}`, { cause: e });
  }

  return val as Url;
};

export const parseDomain = (val: string): Domain => {
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(val)) {
    throw new TypeError(`Invalid domain: ${val}`);
  }

  return val as Domain;
};
