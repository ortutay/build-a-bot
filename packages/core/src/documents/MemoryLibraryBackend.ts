import type { DocumentId, DocumentLibraryBackend, StoredDocument } from './DocumentLibrary.js';

const clone = (document: StoredDocument): StoredDocument => ({
  ...document,
  headers: { ...document.headers },
  request: {
    ...document.request,
    headers: { ...document.request.headers },
  },
});

export class MemoryLibraryBackend implements DocumentLibraryBackend {
  private documents = new Map<DocumentId, StoredDocument>();

  save(document: StoredDocument): void {
    this.documents.set(document.id, clone(document));
  }

  get(id: DocumentId): StoredDocument | null {
    const document = this.documents.get(id);
    return document ? clone(document) : null;
  }

  list(): StoredDocument[] {
    return [...this.documents.values()].map(clone);
  }
}
