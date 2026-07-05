import { describe, expect, it } from "vitest";

// The generator is a CommonJS script that requires the ESM module
// translations-lib.ts through Node's native type stripping. Vitest's
// transform pipeline would paper over that seam if the script were imported
// here, so run it in a plain Node child process, exactly like `npm run lint`
// and test/global-setup.mjs do, and assert on the manifest it writes to the
// real (gitignored) output path.
describe("gen-language-manifest.cjs", () => {
  it("runs under plain Node and writes a well-formed manifest", async () => {
    // tsconfig restricts `types` to @types/w3c-web-serial, so node
    // module specifiers don't type-check; vitest resolves them fine.
    // @ts-ignore — node-only module
    const { execFileSync } = await import("node:child_process");
    // @ts-ignore — node-only module
    const fs = await import("node:fs");
    // @ts-ignore — node-only module
    const path = await import("node:path");
    // @ts-ignore — node-only module
    const url = await import("node:url");

    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const root = path.resolve(here, "../..");
    const script = path.join(root, "build-scripts", "gen-language-manifest.cjs");

    // @ts-ignore — node-only global
    const nodeBinary: string = process.execPath;
    const stdout = execFileSync(nodeBinary, [script], { encoding: "utf-8" });
    expect(stdout).toContain("language-manifest.json");

    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(root, "src", "generated", "language-manifest.json"),
        "utf-8"
      )
    ) as Record<string, { language: string; flag: string; completeness: number }>;

    // en.json is the committed source-of-truth locale: always present, and
    // by definition 100% complete against its own key set.
    expect(manifest.en).toBeDefined();
    expect(manifest.en.language).toBe("English");
    expect(manifest.en.flag).toBe("🇬🇧");
    expect(manifest.en.completeness).toBe(100);

    // Every entry (downloaded locales included, when present) carries the
    // fields the language picker renders synchronously.
    for (const [code, entry] of Object.entries(manifest)) {
      expect(typeof entry.language, `${code}.language`).toBe("string");
      expect(entry.language.length).toBeGreaterThan(0);
      expect(typeof entry.flag, `${code}.flag`).toBe("string");
      expect(entry.completeness).toBeGreaterThanOrEqual(0);
      expect(entry.completeness).toBeLessThanOrEqual(100);
    }
  });
});
