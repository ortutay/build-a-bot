import { documentLibraryPath } from '../constants.js';
import { DiskLibraryBackend } from './DiskLibraryBackend.js';
import { DocumentLibrary } from './DocumentLibrary.js';
import { MemoryLibraryBackend } from './MemoryLibraryBackend.js';

export * from './DocumentLibrary.js';
export * from './DiskLibraryBackend.js';
export * from './MemoryLibraryBackend.js';

export const documentLibrary = new DocumentLibrary(
  documentLibraryPath ? new DiskLibraryBackend(documentLibraryPath) : new MemoryLibraryBackend()
);
