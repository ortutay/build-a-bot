import fs from 'fs';
import path from 'path';
import type { DocumentId, DocumentLibraryBackend, StoredDocument } from './DocumentLibrary.js';

const hasCode = (e: unknown, code: string): boolean =>
  e instanceof Error && 'code' in e && (e as { code?: unknown }).code === code;

export class DiskLibraryBackend implements DocumentLibraryBackend {
  constructor(private dirname: string) {
    fs.mkdirSync(dirname, { recursive: true });
  }

  save(document: StoredDocument): void {
    fs.writeFileSync(this.filepath(document.id), JSON.stringify(document), 'utf8');
  }

  get(id: DocumentId): StoredDocument | null {
    const filepath = this.filepath(id);
    let serialized: string;
    try {
      serialized = fs.readFileSync(filepath, 'utf8');
    } catch (e) {
      if (hasCode(e, 'ENOENT')) return null;
      throw e;
    }

    return this.parse(filepath, serialized);
  }

  list(): StoredDocument[] {
    return fs
      .readdirSync(this.dirname)
      .filter((filename) => filename.endsWith('.json'))
      .sort()
      .map((filename) => {
        const filepath = path.join(this.dirname, filename);
        return this.parse(filepath, fs.readFileSync(filepath, 'utf8'));
      });
  }

  private filepath(id: DocumentId): string {
    return path.join(this.dirname, `${encodeURIComponent(id)}.json`);
  }

  private parse(filepath: string, serialized: string): StoredDocument {
    try {
      return JSON.parse(serialized) as StoredDocument;
    } catch (e) {
      throw new Error(`Could not parse document file ${filepath}: ${String(e)}`);
    }
  }
}
