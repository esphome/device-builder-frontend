import { describe, expect, it } from "vitest";

const load = async () =>
  (await import("../../build-scripts/check-import-cycles.cjs")) as {
    cyclesAmong: (sources: Record<string, string>) => string[][];
    findCycles: (graph: Map<string, Set<string>>) => string[][];
    runtimeImports: (source: string) => string[];
  };

describe("runtimeImports", () => {
  it("keeps the imports that exist at runtime", async () => {
    const { runtimeImports } = await load();
    expect(
      runtimeImports(
        [
          'import { a } from "./a.js";',
          'import b, { type B } from "./b.js";',
          'import "./side-effect.js";',
          'export * from "./re-export.js";',
          "import {\n  c,\n  type C,\n} from './multi-line.js';",
        ].join("\n")
      )
    ).toEqual([
      "./a.js",
      "./b.js",
      "./side-effect.js",
      "./re-export.js",
      "./multi-line.js",
    ]);
  });

  it("drops what the compiler erases, packages, lazy imports and comments", async () => {
    const { runtimeImports } = await load();
    expect(
      runtimeImports(
        [
          'import type { A } from "./types.js";',
          'export type { B } from "./types.js";',
          'export type * from "./types.js";',
          'import { type C, type D } from "./types.js";',
          'import { html } from "lit";',
          'const lazy = () => import("./lazy.js");',
          '// import { e } from "./commented.js";',
          '/*\nimport { f } from "./block.js";\n*/',
        ].join("\n")
      )
    ).toEqual([]);
  });
  it("keeps the imports after a string that looks like a comment opening", async () => {
    const { runtimeImports } = await load();
    expect(
      runtimeImports(
        [
          'const accept = "image/*";',
          'import { x } from "./x.js";',
          'const glob = "**/*.ts"; /* trailing */',
          'import { y } from "./y.js";',
        ].join("\n")
      )
    ).toEqual(["./x.js", "./y.js"]);
  });
});

describe("findCycles", () => {
  it("groups the modules that reach each other and leaves a chain alone", async () => {
    const { findCycles } = await load();
    const graph = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["c"])],
      ["c", new Set(["a", "d"])],
      ["d", new Set<string>()],
      ["e", new Set(["a"])],
    ]);
    expect(findCycles(graph)).toEqual([["a", "b", "c"]]);
  });

  it("reports a module that imports itself", async () => {
    const { findCycles } = await load();
    expect(findCycles(new Map([["a", new Set(["a"])]]))).toEqual([["a"]]);
  });

  it("walks a chain deeper than the call stack would allow", async () => {
    const { findCycles } = await load();
    const graph = new Map<string, Set<string>>();
    for (let i = 0; i < 20000; i++) graph.set(`m${i}`, new Set([`m${i + 1}`]));
    graph.set("m20000", new Set());
    expect(findCycles(graph)).toEqual([]);
  });
});

describe("cyclesAmong", () => {
  it("finds a cycle across directories, through a .js specifier and an index", async () => {
    const { cyclesAmong } = await load();
    expect(
      cyclesAmong({
        "components/dialog.ts": 'import { platform } from "../platforms/index.js";',
        "platforms/index.ts": 'export * from "./rtl.js";',
        "platforms/rtl.ts": 'import { dialog } from "../components/dialog.js";',
        "util/alone.ts": 'import { platform } from "../platforms";',
      })
    ).toEqual([["components/dialog.ts", "platforms/index.ts", "platforms/rtl.ts"]]);
  });

  it("passes when only types cross back", async () => {
    const { cyclesAmong } = await load();
    expect(
      cyclesAmong({
        "a.ts": 'import { b } from "./b.js";',
        "b.ts": 'import type { A } from "./a.js";',
      })
    ).toEqual([]);
  });
});
