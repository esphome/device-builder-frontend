/**
 * Vite serves `?raw` imports as the file's text. Declared here rather than by
 * pulling in `vite/client` repo-wide, which would widen the ambient types for
 * src/ as well to type one import in one test.
 */
declare module "*?raw" {
  const content: string;
  export default content;
}
