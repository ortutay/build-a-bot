import { collapseHtml, collapseJson, remove, slimHtml } from '../formats.js';
import { log } from '../logger.js';
import { srid } from '../util/index.js';
import { MemoryLibraryBackend } from './MemoryLibraryBackend.js';

export type DocumentId = string;

/**
 * `navigation` is content captured from the original browser page navigation.
 * `dynamic` is content returned by an independent dynamic XHR/fetch request.
 */
export const documentOrigins = ['navigation', 'dynamic'] as const;

export type Origin = (typeof documentOrigins)[number];

export const documentContentTypes = ['text/html', 'application/json'] as const;

export type ContentType = (typeof documentContentTypes)[number];

export type DocumentHeaders = Record<string, string>;

export const documentRequestModes = ['fetch', 'browser'] as const;

export type DocumentRequest = {
  timestamp: string;
  headers: DocumentHeaders;
  proxy: string | null;
  mode: (typeof documentRequestModes)[number];
};

export const documentFormats = ['raw', 'html', 'slimHtml'] as const;

export const documentTransforms = ['none', 'collapse'] as const;

export type DocumentInput = {
  url: string;
  origin: Origin;
  contentType: ContentType;
  status: number | null;
  headers: DocumentHeaders;
  request: DocumentRequest;
  content: string;
};

export type DocumentSummary = {
  id: DocumentId;
  url: string;
  origin: Origin;
  contentType: ContentType;
  status: number | null;
  bytes: number;
};

export type Document = DocumentSummary & {
  headers: DocumentHeaders;
  request: DocumentRequest;
  format: (typeof documentFormats)[number];
  transform: (typeof documentTransforms)[number];
  content: string;
};

export type DocumentListQuery = {
  documentIds?: DocumentId[];
  origin?: Origin;
  contentType?: ContentType;
  urlPrefix?: string;
  offset?: number;
  limit?: number;
};

export type StoredDocument = DocumentInput & {
  id: DocumentId;
  bytes: number;
};

export type DocumentLibraryBackend = {
  save(document: StoredDocument): void;
  get(id: DocumentId): StoredDocument | null;
  list(): StoredDocument[];
};

const maxListLimit = 50;

const isHtml = (contentType: ContentType): boolean => contentType === 'text/html';

const isJson = (contentType: ContentType): boolean => contentType === 'application/json';

export class DocumentLibrary {
  constructor(private backend: DocumentLibraryBackend = new MemoryLibraryBackend()) {}

  save(input: DocumentInput): DocumentId {
    const id = `doc:${srid()}`;
    const document: StoredDocument = {
      ...input,
      id,
      headers: { ...input.headers },
      request: {
        ...input.request,
        headers: { ...input.request.headers },
      },
      bytes: Buffer.byteLength(input.content, 'utf8'),
    };

    this.backend.save(document);
    log.info(
      `Saved document: id=${id}, status=${input.status}, contentType=${input.contentType}, url=${input.url}`
    );
    return id;
  }

  summary(id: DocumentId): DocumentSummary | null {
    const document = this.backend.get(id);
    return document ? this.toSummary(document) : null;
  }

  get(
    id: DocumentId,
    format: (typeof documentFormats)[number] = 'raw',
    transform: (typeof documentTransforms)[number] = 'none'
  ): Document | null {
    const document = this.backend.get(id);
    if (!document) {
      log.info(`Get document: id=${id}, status=missing`);
      return null;
    }

    log.info(`Get document: id=${id}, format=${format}, transform=${transform}`);

    return {
      ...this.toSummary(document),
      headers: { ...document.headers },
      request: {
        ...document.request,
        headers: { ...document.request.headers },
      },
      format,
      transform,
      content: this.render(document, format, transform),
    };
  }

  list(query: DocumentListQuery = {}): DocumentSummary[] {
    const ids = query.documentIds ? new Set(query.documentIds) : null;
    const offset = this.listOffset(query.offset);
    const limit = this.listLimit(query.limit);

    const documents = this.backend
      .list()
      .filter((document) => {
        if (ids && !ids.has(document.id)) return false;
        if (query.origin && document.origin !== query.origin) return false;
        if (query.contentType && document.contentType !== query.contentType) return false;
        if (query.urlPrefix && !document.url.startsWith(query.urlPrefix)) return false;
        return true;
      })
      .slice(offset, offset + limit)
      .map((document) => this.toSummary(document));

    log.info(`List documents: offset=${offset}, limit=${limit}, count=${documents.length}`);
    return documents;
  }

  private toSummary(document: StoredDocument): DocumentSummary {
    return {
      id: document.id,
      url: document.url,
      origin: document.origin,
      contentType: document.contentType,
      status: document.status,
      bytes: document.bytes,
    };
  }

  private render(
    document: StoredDocument,
    format: (typeof documentFormats)[number],
    transform: (typeof documentTransforms)[number]
  ): string {
    let content: string;

    if (format === 'raw') {
      content = document.content;
    } else if (format === 'html') {
      if (!isHtml(document.contentType)) {
        throw new Error(`Format "${format}" is unavailable for ${document.contentType}`);
      }
      content = remove(document.content);
    } else if (format === 'slimHtml') {
      if (!isHtml(document.contentType)) {
        throw new Error(`Format "${format}" is unavailable for ${document.contentType}`);
      }
      content = slimHtml({ html: document.content, url: document.url });
    } else {
      throw new Error(`Unknown document format: ${String(format)}`);
    }

    if (transform === 'none') return content;
    if (transform === 'collapse' && isHtml(document.contentType)) return collapseHtml(content);
    if (transform === 'collapse' && isJson(document.contentType)) return collapseJson(content);

    throw new Error(`Unknown document transform: ${String(transform)}`);
  }

  private listLimit(limit: number | undefined): number {
    if (limit === undefined) return maxListLimit;
    if (!Number.isFinite(limit) || limit < 0) return 0;
    return Math.min(Math.floor(limit), maxListLimit);
  }

  private listOffset(offset: number | undefined): number {
    if (offset === undefined || !Number.isFinite(offset) || offset < 0) return 0;
    return Math.floor(offset);
  }
}
