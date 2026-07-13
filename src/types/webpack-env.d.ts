// Ambient types for the bundler's build-time `import.meta.webpackContext`
// helper (rspack / webpack). Under the bundler the call is replaced with a
// real context factory; under vitest it doesn't exist, so call sites wrap it
// in try/catch and fall back to the statically-imported English base.

interface WebpackModuleContext {
  keys(): string[];
  // Synchronous modes return the module directly; lazy modes return a
  // Promise. Typed as `unknown` so call sites narrow for their mode.
  (id: string): unknown;
  readonly id: string | number;
}

interface ImportMeta {
  webpackContext(
    request: string,
    options?: {
      recursive?: boolean;
      regExp?: RegExp;
      include?: RegExp;
      exclude?: RegExp;
      mode?: "sync" | "eager" | "weak" | "lazy" | "lazy-once";
      chunkName?: string;
    }
  ): WebpackModuleContext;
}

/** Replaced by rspack's DefinePlugin; true only for the dev-server bundle. */
declare const __DEV__: boolean;
