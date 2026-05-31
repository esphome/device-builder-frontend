/**
 * @vitest-environment happy-dom
 *
 * Guards the #1031 leak fix: webawesome 3.7.0's wa-option awaits
 * ``customElements.whenDefined("wa-combobox")``, which never resolves
 * because no build ships wa-combobox — so each form mount's reaction was
 * retained forever, leaking the wa-select / editor subtree. The fix
 * registers a stub so the promise settles.
 */
import { describe, expect, it } from "vitest";
import { installWaComboboxLeakFix } from "../../src/util/wa-combobox-leak-fix.js";

describe("wa-combobox leak fix", () => {
  it("registers a wa-combobox stub so whenDefined resolves", async () => {
    expect(customElements.get("wa-combobox")).toBeUndefined();
    installWaComboboxLeakFix();
    expect(customElements.get("wa-combobox")).toBeDefined();
    // The leak was a never-settling whenDefined promise; awaiting it here
    // must complete (a hang would fail the test by timeout).
    await customElements.whenDefined("wa-combobox");
  });

  it("is idempotent", () => {
    installWaComboboxLeakFix();
    expect(() => installWaComboboxLeakFix()).not.toThrow();
  });
});
