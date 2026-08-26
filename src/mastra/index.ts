// Mastra Platform invokes `mastra build` from the monorepo root. Keep this
// repository-level entry point so it can discover the Core workspace app.
export { mastra } from '../../packages/core/src/mastra/index.js';
