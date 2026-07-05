/**
 * Per-file vitest setup (see ``setupFiles`` in vitest.config.ts).
 *
 * Registers the one global ``afterEach`` that clears ``document.body``
 * between tests, replacing the per-file cleanup boilerplate the DOM suites
 * used to copy around. Guarded because the suite's default environment is
 * node (no DOM); only files opting into happy-dom via the
 * ``@vitest-environment`` pragma have a document to clear.
 */
import { afterEach } from "vitest";

afterEach(() => {
  if (typeof document !== "undefined") {
    document.body?.replaceChildren();
  }
});
