// @vitest-environment happy-dom
import { CompletionContext } from "@codemirror/autocomplete";
import { forceParsing } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import { createYamlCompletionSource } from "../../src/util/yaml-completion.js";

// The substitution branch returns before the catalog loads, so an empty API
// is enough.
const fakeApi = {
  getComponents: async () => ({ components: [] }),
  getComponentBodies: async () => ({}),
  getComponent: async () => null,
} as never;

async function completeAt(doc: string, pos: number) {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [esphomeYaml()] }),
  });
  try {
    forceParsing(view, doc.length, 60000);
    const ctx = new CompletionContext(view.state, pos, false);
    return await createYamlCompletionSource(fakeApi)(ctx);
  } finally {
    view.destroy();
  }
}

const HEAD = ["substitutions:", "  name: x", "esphome:", "  name: ${name"].join("\n");

describe("substitution ${} completion", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 }))
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("swallows the closeBrackets-inserted ``}`` so the value isn't doubled", async () => {
    // closeBrackets auto-inserts ``}`` when ``{`` is typed: the buffer already
    // reads ``${name}`` with the cursor before the brace.
    const doc = `${HEAD}}`;
    const pos = HEAD.length;
    const result = await completeAt(doc, pos);
    expect(result).not.toBeNull();
    expect(result!.to).toBe(pos + 1);
    const opt = result!.options[0];
    expect(opt.apply).toBe("${name}");
    const applied = doc.slice(0, result!.from) + opt.apply + doc.slice(result!.to!);
    expect(applied.endsWith("name: ${name}")).toBe(true);
    expect(applied).not.toContain("}}");
  });

  it("emits a single ``}`` when no brace follows the cursor", async () => {
    // No auto-close (paste, bracket-matching off): the completion supplies the
    // closing brace itself.
    const doc = HEAD;
    const pos = HEAD.length;
    const result = await completeAt(doc, pos);
    expect(result).not.toBeNull();
    expect(result!.to).toBe(pos);
    const opt = result!.options[0];
    const applied = doc.slice(0, result!.from) + opt.apply + doc.slice(result!.to!);
    expect(applied.endsWith("name: ${name}")).toBe(true);
    expect(applied).not.toContain("}}");
  });
});
