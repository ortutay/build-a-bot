import { type Url, parseUrl } from '../types.js';

export type DataSourceOptions = {
  url: string;
  // domain?: Domain,
  // startUrls?: Url[],
};

export class DataSource {
  url: Url;
  // domain: Domain;
  // startUrls: Url[];

  constructor({
    url,
    // domain,
    // startUrls = []
  }: DataSourceOptions) {
    // this.domain = domain ;
    // this.startUrls = startUrls;
    this.url = parseUrl(url);
  }
}
