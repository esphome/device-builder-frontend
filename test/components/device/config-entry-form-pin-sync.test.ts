/**
 * @vitest-environment happy-dom
 *
 * `_syncSelectedAttr` drives the `data-no-value-sync` selects (pin pickers,
 * unit pickers) off their `?selected` option. The pin select DOM node is
 * reused across a "+ Add <dep>" detour, so an unset pin must CLEAR rather
 * than keep the stale `.value` that bled in from the dep's own form.
 */
import { describe, expect, it } from "vitest";

import { ESPHomeConfigEntryForm } from "../../../src/components/device/config-entry-form.js";

interface FakeSelect {
  value: string;
  querySelector: (sel: string) => { value: string } | null;
}

function syncSelectedAttr(select: FakeSelect): Promise<void> {
  const form = new ESPHomeConfigEntryForm();
  return (
    form as unknown as { _syncSelectedAttr: (s: FakeSelect) => Promise<void> }
  )._syncSelectedAttr(select);
}

describe("_syncSelectedAttr", () => {
  it("clears a stale value when no option is selected", async () => {
    // No `wa-option[selected]` => the field's value is unset => clear.
    const select: FakeSelect = { value: "GPIO18", querySelector: () => null };
    await syncSelectedAttr(select);
    expect(select.value).toBe("");
  });

  it("syncs to the selected option's value", async () => {
    const select: FakeSelect = {
      value: "",
      querySelector: () => ({ value: "GPIO5" }),
    };
    await syncSelectedAttr(select);
    expect(select.value).toBe("GPIO5");
  });

  it("leaves an already-correct value untouched", async () => {
    let writes = 0;
    let current = "GPIO5";
    const select = {
      get value() {
        return current;
      },
      set value(v: string) {
        current = v;
        writes++;
      },
      querySelector: () => ({ value: "GPIO5" }),
    };
    await syncSelectedAttr(select as unknown as FakeSelect);
    expect(current).toBe("GPIO5");
    expect(writes).toBe(0);
  });
});
