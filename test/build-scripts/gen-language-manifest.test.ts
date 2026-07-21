import { describe, expect, it } from "vitest";

// The generator is a CommonJS script that requires the ESM module
// translations-lib.ts through Node's native type stripping. Vitest's
// transform pipeline would paper over that seam if the script were imported
// here, so run it in a plain Node child process, exactly like `pnpm run lint`
// and test/global-setup.mjs do. The script's optional output-path argument
// points the write at a temp directory so the test never touches (or races
// other tooling on) the real src/generated file.
describe("gen-language-manifest.cjs", () => {
  it("runs under plain Node and writes a well-formed manifest", async () => {
    // tsconfig restricts `types` to @types/w3c-web-serial, so node
    // module specifiers don't type-check; vitest resolves them fine.
    // @ts-expect-error — node-only module
    const { execFileSync } = await import("node:child_process");
    // @ts-expect-error — node-only module
    const fs = await import("node:fs");
    // @ts-expect-error — node-only module
    const os = await import("node:os");
    // @ts-expect-error — node-only module
    const path = await import("node:path");
    // @ts-expect-error — node-only module
    const url = await import("node:url");

    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const root = path.resolve(here, "../..");
    const script = path.join(root, "build-scripts", "gen-language-manifest.cjs");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gen-language-manifest-"));
    const outFile = path.join(tmpDir, "language-manifest.json");
    try {
      // @ts-expect-error — node-only global
      const nodeBinary: string = process.execPath;
      // execFileSync throws on a non-zero exit, so returning at all asserts
      // the script ran to completion under the real Node loader.
      execFileSync(nodeBinary, [script, outFile], { encoding: "utf-8" });

      expect(fs.existsSync(outFile)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(outFile, "utf-8")) as Record<
        string,
        { language: string; flag: string; completeness: number }
      >;

      // en.json is the committed source-of-truth locale: always present, and
      // by definition 100% complete against its own key set. Its autonym and
      // flag are translation content that can legitimately change, so the
      // per-entry loop below only checks they are present and non-empty.
      expect(manifest.en).toBeDefined();
      expect(manifest.en.completeness).toBe(100);

      // Every entry (downloaded locales included, when present) carries the
      // fields the language picker renders synchronously.
      for (const [code, entry] of Object.entries(manifest)) {
        expect(typeof entry.language, `${code}.language`).toBe("string");
        expect(entry.language.length, `${code}.language`).toBeGreaterThan(0);
        expect(typeof entry.flag, `${code}.flag`).toBe("string");
        expect(entry.flag.length, `${code}.flag`).toBeGreaterThan(0);
        expect(entry.completeness, `${code}.completeness`).toBeGreaterThanOrEqual(0);
        expect(entry.completeness, `${code}.completeness`).toBeLessThanOrEqual(100);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
