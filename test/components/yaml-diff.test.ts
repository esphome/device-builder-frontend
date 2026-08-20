/**
 * @vitest-environment happy-dom
 *
 * Pins the diff renderer's credential masking (#2605): sensitive values
 * are wrapped in masked spans by default, the diff still shows a changed
 * credential as a remove/add pair, and `revealSensitive` lifts the mask.
 */
import { describe, expect, it } from "vitest";

import { mount } from "../_dom.js";
import { ESPHomeYamlDiff } from "../../src/components/yaml-diff.js";

const OLD_YAML = [
  "esphome:",
  "  name: test3",
  "wifi:",
  "  ssid: mynetwork",
  "  password: hunter2",
  "api:",
  "  encryption:",
  "    key: q1w2e3r4t5y6u7i8o9p0==",
].join("\n");

const NEW_YAML = [
  "esphome:",
  "  name: test3",
  "logger:",
  "wifi:",
  "  ssid: mynetwork",
  "  password: hunter3",
  "api:",
  "  encryption:",
  "    key: q1w2e3r4t5y6u7i8o9p0==",
].join("\n");

function rowsContaining(el: ESPHomeYamlDiff, text: string): HTMLTableRowElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll<HTMLTableRowElement>("tr")).filter(
    (r) => r.textContent!.includes(text)
  );
}

function sensitiveSpans(scope: ParentNode) {
  return Array.from(scope.querySelectorAll<HTMLSpanElement>(".content .sensitive"));
}

describe("yaml-diff credential masking", () => {
  it("masks a changed password on both the removed and added rows", async () => {
    const el = await mount(new ESPHomeYamlDiff(), {
      oldValue: OLD_YAML,
      newValue: NEW_YAML,
    });
    const passwordRows = rowsContaining(el, "password:");
    expect(passwordRows).toHaveLength(2);
    expect(passwordRows[0].className).toBe("remove");
    expect(passwordRows[1].className).toBe("add");
    expect(sensitiveSpans(passwordRows[0])[0].textContent).toBe("hunter2");
    expect(sensitiveSpans(passwordRows[1])[0].textContent).toBe("hunter3");
    // Only the value is inside the masked span; the key stays readable.
    const content = passwordRows[0].querySelector(".content")!;
    expect(content.textContent).toBe("  password: hunter2");
  });

  it("masks a parent-scoped encryption key on context rows", async () => {
    const el = await mount(new ESPHomeYamlDiff(), {
      oldValue: OLD_YAML,
      newValue: NEW_YAML,
    });
    const keyRow = rowsContaining(el, "key:")[0];
    expect(keyRow.className).toBe("context");
    expect(sensitiveSpans(keyRow)[0].textContent).toBe("q1w2e3r4t5y6u7i8o9p0==");
  });

  it("masks a context row that is sensitive only on the old side", async () => {
    // Deleting `encryption:` leaves the byte-identical `key:` line parented
    // by `api:`, where the new-side scan alone would let it through.
    const el = await mount(new ESPHomeYamlDiff(), {
      oldValue: "api:\n  encryption:\n    key: q1w2e3r4==\n",
      newValue: "api:\n    key: q1w2e3r4==\n",
    });
    const keyRow = rowsContaining(el, "key:")[0];
    expect(keyRow.className).toBe("context");
    expect(sensitiveSpans(keyRow)[0].textContent).toBe("q1w2e3r4==");
  });

  it("leaves non-sensitive values unwrapped", async () => {
    const el = await mount(new ESPHomeYamlDiff(), {
      oldValue: OLD_YAML,
      newValue: NEW_YAML,
    });
    expect(sensitiveSpans(rowsContaining(el, "ssid:")[0])).toHaveLength(0);
    expect(sensitiveSpans(rowsContaining(el, "logger:")[0])).toHaveLength(0);
  });

  it("reveals everything when revealSensitive is set", async () => {
    const el = await mount(new ESPHomeYamlDiff(), {
      oldValue: OLD_YAML,
      newValue: NEW_YAML,
      revealSensitive: true,
    });
    expect(sensitiveSpans(el.shadowRoot!)).toHaveLength(0);

    el.revealSensitive = false;
    await el.updateComplete;
    expect(sensitiveSpans(el.shadowRoot!).length).toBeGreaterThan(0);
  });
});
