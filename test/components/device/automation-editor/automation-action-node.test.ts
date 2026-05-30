/**
 * Source-scan tests for ``automation-action-node.ts``. The element
 * pulls in CodeMirror via the config-entry-form lambda renderer, so
 * it can't mount under the node test environment; pin the
 * advanced-toggle wiring at the source level instead.
 */
import { describe, expect, it } from "vitest";

async function readSource(): Promise<string> {
  // @ts-ignore — node-only module
  const fs = await import("node:fs");
  // @ts-ignore — node-only module
  const path = await import("node:path");
  // @ts-ignore — node-only module
  const url = await import("node:url");
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  return fs.readFileSync(
    path.resolve(
      here,
      "../../../../src/components/device/automation-editor/automation-action-node.ts"
    ),
    "utf-8"
  );
}

describe("automation-action-node advanced toggle", () => {
  it("carries _showAdvanced state and routes through the shared toggle helper", async () => {
    const src = await readSource();
    expect(src).toMatch(/_showAdvanced\s*=\s*false/);
    expect(src).toContain('import { renderAdvancedToggle } from "../advanced-toggle.js"');
    expect(src).toContain("renderAdvancedToggle(this._showAdvanced");
  });

  it("feeds _showAdvanced (or the all-advanced auto-open) into the params form", async () => {
    const src = await readSource();
    expect(src).toMatch(/\?show-advanced=\$\{allAdvanced \|\| this\._showAdvanced\}/);
    expect(src).toContain("anyAdvancedEntry(def.config_entries)");
  });

  it("renders the toggle only for the mixed required+advanced case", async () => {
    const src = await readSource();
    // ``!allAdvanced`` keeps the toggle off the all-advanced auto-open
    // path (delay), where the form is already force-opened.
    expect(src).toMatch(/hasAdvanced && !allAdvanced/);
  });
});
