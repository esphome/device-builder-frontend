import { describe, expect, it } from "vitest";

// Runs the CLI in a plain Node child process (native type stripping), like
// the real release workflow, against temp directories.
async function setup() {
  // tsconfig restricts `types` to @types/w3c-web-serial, so node
  // module specifiers don't type-check; vitest resolves them fine.
  // @ts-expect-error - node-only module
  const cp = await import("node:child_process");
  // @ts-expect-error - node-only module
  const fs = await import("node:fs");
  // @ts-expect-error - node-only module
  const os = await import("node:os");
  // @ts-expect-error - node-only module
  const path = await import("node:path");
  // @ts-expect-error - node-only module
  const url = await import("node:url");

  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const script = path.join(
    here,
    "../..",
    "build-scripts",
    "translation-release-notes.ts"
  );
  const tmp: string = fs.mkdtempSync(path.join(os.tmpdir(), "translation-notes-"));
  // @ts-expect-error - node-only global
  const nodeBinary: string = process.execPath;

  const write = (dir: string, file: string, data: unknown): void => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), JSON.stringify(data));
  };
  const run = (...args: string[]): { status: number; stdout: string; stderr: string } => {
    const res = cp.spawnSync(nodeBinary, [script, ...args], { encoding: "utf-8" });
    return { status: res.status, stdout: res.stdout, stderr: res.stderr };
  };
  const cleanup = (): void => fs.rmSync(tmp, { recursive: true, force: true });
  return { path, tmp, write, run, cleanup };
}

describe("translation-release-notes.ts", () => {
  const en = { a: "A", b: "B" };

  it("prints the section for changed and new languages", async () => {
    const { path, tmp, write, run, cleanup } = await setup();
    try {
      const prev = path.join(tmp, "prev");
      const cur = path.join(tmp, "cur");
      write(prev, "de.json", { language: "Deutsch", a: "x" });
      write(cur, "en.json", en);
      write(cur, "de.json", { language: "Deutsch", a: "x", b: "y" });
      write(cur, "zh_CN.json", { language: "中文", a: "x" });
      const res = run(prev, cur);
      expect(res.status).toBe(0);
      expect(res.stdout).toBe(
        "## 🌍 Translations\n\n" +
          "Thank you to our translators on [Lokalise](https://lokalise.com/) for the translation updates in this release:\n\n" +
          "- Deutsch: 50% → 100%\n" +
          "- 中文 (new): 50%\n"
      );
    } finally {
      cleanup();
    }
  });

  it("measures previous percentages against the previous en.json", async () => {
    const { path, tmp, write, run, cleanup } = await setup();
    try {
      const prev = path.join(tmp, "prev");
      const cur = path.join(tmp, "cur");
      write(prev, "en.json", { a: "A" });
      write(prev, "de.json", { language: "Deutsch", a: "x" });
      write(cur, "en.json", en);
      write(cur, "de.json", { language: "Deutsch", a: "x", b: "y" });
      const res = run(prev, cur);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("- Deutsch: 100%\n");
      expect(res.stdout).not.toContain("→");
    } finally {
      cleanup();
    }
  });

  it("prints nothing when nothing changed", async () => {
    const { path, tmp, write, run, cleanup } = await setup();
    try {
      const prev = path.join(tmp, "prev");
      const cur = path.join(tmp, "cur");
      write(prev, "en.json", en);
      write(prev, "de.json", { a: "x" });
      write(cur, "en.json", en);
      write(cur, "de.json", { a: "x" });
      write(cur, "notes.txt", "ignored");
      const res = run(prev, cur);
      expect(res.status).toBe(0);
      expect(res.stdout).toBe("");
    } finally {
      cleanup();
    }
  });

  it("treats a missing previous directory as empty", async () => {
    const { path, tmp, write, run, cleanup } = await setup();
    try {
      const cur = path.join(tmp, "cur");
      write(cur, "en.json", en);
      write(cur, "fr.json", { language: "Français", a: "x", b: "y" });
      const res = run(path.join(tmp, "missing"), cur);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("- Français (new): 100%\n");
    } finally {
      cleanup();
    }
  });

  it("prints usage and exits 1 on bad arguments", async () => {
    const { run, cleanup } = await setup();
    try {
      for (const args of [[], ["only-one"], ["a", "b", "c"]]) {
        const res = run(...args);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain("Usage:");
        expect(res.stdout).toBe("");
      }
    } finally {
      cleanup();
    }
  });
});
