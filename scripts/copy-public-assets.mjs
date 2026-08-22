import { cpSync, mkdirSync } from 'node:fs';

const source = new URL('../src/mastra/public/', import.meta.url);
const destination = new URL('../dist/mastra/public/', import.meta.url);

mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
