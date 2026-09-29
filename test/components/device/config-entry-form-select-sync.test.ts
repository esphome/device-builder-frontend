/**
 * @vitest-environment happy-dom
 *
 * ``_syncSelectValues`` pushes each field's value onto its wa-select after
 * every render: it waits for the select's first update only, skips a select
 * already showing the value, and otherwise scans the options for a case or
 * bare-decimal match.
 */
import { describe, expect, it, vi } from "vitest";

import { ESPHomeConfigEntryForm } from "../../../src/components/device/config-entry-form.js";

interface FakeSelect {
  value: string;
  hasUpdated: boolean;
  /** Thenable that counts awaits. */
  updateComplete: { then: (onFulfilled: (v: unknown) => unknown) => Promise<unknown> };
  awaited: number;
  scans: number;
  hasAttribute: (name: string) => boolean;
  querySelectorAll: (sel: string) => Array<{ value: string }>;
}

function fakeSelect(opts: {
  value: string;
  options: string[];
  hasUpdated?: boolean;
}): FakeSelect {
  const select: FakeSelect = {
    value: opts.value,
    hasUpdated: opts.hasUpdated ?? true,
    awaited: 0,
    scans: 0,
    hasAttribute: () => false,
    querySelectorAll: () => {
      select.scans++;
      return opts.options.map((value) => ({ value }));
    },
    updateComplete: {
      then(onFulfilled: (v: unknown) => unknown) {
        select.awaited++;
        return Promise.resolve(true).then(onFulfilled);
      },
    },
  };
  return select;
}

async function sync(select: FakeSelect, value: unknown): Promise<void> {
  const form = new ESPHomeConfigEntryForm();
  form.values = { field: value };
  const field = { querySelector: () => select };
  Object.defineProperty(form, "shadowRoot", {
    value: { querySelectorAll: () => [field] },
  });
  vi.spyOn(
    form as unknown as { _pathOf: (f: unknown) => string[] },
    "_pathOf"
  ).mockReturnValue(["field"]);
  await (
    form as unknown as { _syncSelectValues: () => Promise<void> }
  )._syncSelectValues();
}

describe("_syncSelectValues", () => {
  it("awaits updateComplete only before the select's first update", async () => {
    const fresh = fakeSelect({ value: "", options: ["a"], hasUpdated: false });
    await sync(fresh, "a");
    expect(fresh.awaited).toBe(1);
    const settled = fakeSelect({ value: "", options: ["a"] });
    await sync(settled, "a");
    expect(settled.awaited).toBe(0);
  });

  it("skips the option scan when the select already shows the value", async () => {
    const select = fakeSelect({ value: "a", options: ["a", "b"] });
    await sync(select, "a");
    expect(select.scans).toBe(0);
    expect(select.value).toBe("a");
  });

  it("case-folds onto an option", async () => {
    const select = fakeSelect({ value: "", options: ["ESP32C6", "ESP32S3"] });
    await sync(select, "esp32c6");
    expect(select.value).toBe("ESP32C6");
  });

  it("maps a bare YAML decimal onto the option spelled with its trailing zero", async () => {
    const select = fakeSelect({ value: "", options: ["2.0", "3.0", "3.1"] });
    await sync(select, 3);
    expect(select.value).toBe("3.0");
  });

  it("leaves a quoted numeric string on its own spelling", async () => {
    const select = fakeSelect({ value: "", options: ["2.0", "3.0", "3.1"] });
    await sync(select, "3");
    expect(select.value).toBe("3");
  });

  it.each([
    ["3.0", 3],
    ["ESP32C6", "esp32c6"],
  ])("skips the scan when the select shows %s for %s", async (current, raw) => {
    const select = fakeSelect({ value: current, options: ["x", current] });
    await sync(select, raw);
    expect(select.scans).toBe(0);
    expect(select.value).toBe(current);
  });

  it("skips the scan for an unset field", async () => {
    const select = fakeSelect({ value: "", options: ["a", "b"] });
    await sync(select, undefined);
    expect(select.scans).toBe(0);
    expect(select.value).toBe("");
  });
});
