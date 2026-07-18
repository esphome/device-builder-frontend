import { vi } from "vitest";

/**
 * In-memory Web Storage stand-ins for node-environment tests (no
 * ``localStorage`` / ``sessionStorage`` globals there).
 *
 * ``stubStorage`` installs a Map-backed stub via ``vi.stubGlobal`` and
 * returns the backing map for direct inspection / seeding.
 * ``stubThrowingStorage`` installs one whose every method throws — the
 * private-mode / sandboxed-iframe failure shape storage helpers must
 * tolerate. Callers keep ``vi.unstubAllGlobals()`` in ``afterEach``.
 */
export function stubStorage(
  name: "localStorage" | "sessionStorage",
  initial?: Record<string, string>
): Map<string, string> {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  vi.stubGlobal(name, {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  });
  return store;
}

export function stubThrowingStorage(name: "localStorage" | "sessionStorage"): void {
  const blocked = () => {
    throw new Error("blocked");
  };
  vi.stubGlobal(name, {
    getItem: blocked,
    setItem: blocked,
    removeItem: blocked,
    clear: blocked,
  });
}
