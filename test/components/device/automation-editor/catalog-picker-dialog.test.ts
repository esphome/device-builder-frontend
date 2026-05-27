/**
 * Source-scan tests for ``<esphome-catalog-picker-dialog>``.
 *
 * We can't mount the Lit element under vitest (no DOM), but the
 * filter / grouping logic is the load-bearing surface and can be
 * pinned via the source-level shape. The behavioural contract is:
 *
 * - "By type" groups by the bare domain (``switch.template`` and
 *   ``switch.gpio`` both land under ``switch``).
 * - "Building blocks" filters to ``domain === "core"`` items.
 * - "By target" pre-fills the picked action's id-shaped
 *   ConfigEntry with the picked device's id.
 * - Search applies case-insensitively across id, name, description.
 */
import { describe, expect, it } from "vitest";

async function readSource(): Promise<string> {
  // @ts-ignore — node-only modules
  const fs = await import("node:fs");
  // @ts-ignore
  const path = await import("node:path");
  // @ts-ignore
  const url = await import("node:url");
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  return fs.readFileSync(
    path.resolve(
      here,
      "../../../../src/components/device/automation-editor/catalog-picker-dialog.ts"
    ),
    "utf-8"
  );
}

describe("catalog-picker-dialog filtering contract", () => {
  /**
   * Extract the body of a private method definition. Anchors on
   * ``private <name>`` (including arrow-form ``= (`` and regular
   * ``(``) and slurps until the next ``private`` / ``}`` boundary.
   */
  function methodBody(src: string, name: string): string {
    const re = new RegExp(
      `private\\s+${name}[\\s\\S]*?(?=\\n {2}(private|static|public|protected|@|\\}))`
    );
    const m = src.match(re);
    if (!m) throw new Error(`Method ${name} not found`);
    return m[0];
  }

  it("applies the search query against id, name, and description", async () => {
    const src = await readSource();
    // Pin the _applyQuery body — must consult all three fields,
    // case-insensitive. A future refactor that drops the
    // description match (the most surprising hit) should fail this
    // test.
    const body = methodBody(src, "_applyQuery");
    expect(body).toMatch(/\.id\.toLowerCase\(\)\.includes\(q\)/);
    expect(body).toMatch(/\.name\.toLowerCase\(\)\.includes\(q\)/);
    expect(body).toMatch(/description.*toLowerCase\(\)\.includes\(q\)/);
  });

  it("filters Building blocks to domain === 'core' items", async () => {
    const src = await readSource();
    const body = methodBody(src, "_renderBuildingBlocks");
    expect(body).toMatch(/domain === "core"/);
  });

  it("By-type skips core items and normalises to bare domain", async () => {
    const src = await readSource();
    const body = methodBody(src, "_renderByType");
    // Must skip core (those go under Building blocks) and split
    // <domain>.<platform> down to its bare <domain> so
    // switch.template + switch.gpio land under the same "switch"
    // header.
    expect(body).toMatch(/domain === "core"/);
    expect(body).toMatch(/domain\.split\("\."\)\[0\]/);
  });

  it("By-target pre-fills the action's id-shaped param with the picked device's id", async () => {
    const src = await readSource();
    const body = methodBody(src, "_preFillFor");
    expect(body).toMatch(/references_component === domain/);
    expect(body).toMatch(/\[idEntry\.key\]: device\.id/);
  });
});

describe("catalog-picker-dialog tab strip", () => {
  it("hides 'by-target' for conditions (they have no target)", async () => {
    const src = await readSource();
    const m = src.match(/this\.kind === "action"\s*\?\s*\[([^\]]+)\]\s*:\s*\[([^\]]+)\]/);
    expect(m).not.toBeNull();
    const actionTabs = m![1];
    const conditionTabs = m![2];
    expect(actionTabs).toMatch(/by-target/);
    expect(conditionTabs).not.toMatch(/by-target/);
    expect(conditionTabs).toMatch(/by-type/);
    expect(conditionTabs).toMatch(/building-blocks/);
  });

  it("defaults the active tab to by-target for actions, by-type for conditions", async () => {
    const src = await readSource();
    // open() pins the initial tab — actions land on "by-target"
    // because the user usually knows what they want to control,
    // and conditions skip straight to "by-type" since they don't
    // have a target axis.
    const m = src.match(/public open[\s\S]*?_activeTab = ([\s\S]*?);/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/"action"/);
    expect(m![1]).toMatch(/"by-target"/);
    expect(m![1]).toMatch(/"by-type"/);
  });
});
