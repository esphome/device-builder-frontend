/**
 * @vitest-environment happy-dom
 *
 * Pins the deprecation nudge: detecting a migratable deprecated option
 * (ethernet `clk_mode`) and the migrate flow that emits `apply-section-values`
 * with the nested `clk` replacement.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import toast from "sonner-js";
import {
  DEPRECATED_OPTIONS,
  ESPHomeDeprecationNotice,
  renamedOption,
} from "../../../src/components/device/deprecation-notice.js";
import enMessages from "../../../src/translations/en.json";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function mount(
  sectionKey: string,
  values: Record<string, unknown>,
  entries: any[] = []
) {
  const el = new ESPHomeDeprecationNotice();
  el.sectionKey = sectionKey;
  el.values = values;
  el.entries = entries;
  const changes: { path: string[]; value: unknown }[][] = [];
  el.addEventListener("apply-section-values", (e) =>
    changes.push((e as CustomEvent).detail.changes)
  );
  document.body.appendChild(el);
  await el.updateComplete;
  return { el, inner: el as any, changes };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("deprecation-notice — detection", () => {
  // [name, sectionKey, values, shows]
  const cases: Array<[string, string, Record<string, unknown>, boolean]> = [
    ["clk_mode present", "ethernet", { type: "LAN8720", clk_mode: "GPIO17_OUT" }, true],
    ["clk_mode absent", "ethernet", { type: "LAN8720" }, false],
    ["clk_mode cleared post-migrate", "ethernet", { clk_mode: undefined }, false],
    ["non-string value", "ethernet", { clk_mode: 17 }, false],
    ["unknown value", "ethernet", { clk_mode: "EXTERNAL" }, false],
    ["!secret value", "ethernet", { clk_mode: "!secret clk" }, false],
    ["non-registry section", "wifi", { clk_mode: "GPIO17_OUT" }, false],
    ["inherited key can't resolve", "__proto__", { clk_mode: "GPIO17_OUT" }, false],
  ];
  for (const [name, sectionKey, values, shows] of cases) {
    it(`${name} → banner ${shows ? "shown" : "hidden"}`, async () => {
      const { el } = await mount(sectionKey, values);
      expect(el.shadowRoot!.querySelector(".notice") !== null).toBe(shows);
    });
  }

  // clk_mode is RMII-only; the schema entry's depends_on gate decides.
  const clkModeEntry = {
    key: "clk_mode",
    depends_on: "type",
    depends_on_value_any: ["LAN8720", "RTL8201"],
  };
  const gated: Array<[string, Record<string, unknown>, boolean]> = [
    ["RMII type satisfies the gate", { type: "LAN8720", clk_mode: "GPIO17_OUT" }, true],
    ["SPI type fails the gate", { type: "W5500", clk_mode: "GPIO17_OUT" }, false],
    ["no schema entry → ungated", { type: "W5500", clk_mode: "GPIO17_OUT" }, true],
  ];
  for (const [name, values, shows] of gated) {
    it(`schema gate: ${name} → banner ${shows ? "shown" : "hidden"}`, async () => {
      const entries = name.includes("no schema entry") ? [] : [clkModeEntry];
      const { el } = await mount("ethernet", values, entries);
      expect(el.shadowRoot!.querySelector(".notice") !== null).toBe(shows);
    });
  }
});

describe("deprecation-notice — migrate", () => {
  // [clk_mode, pin, mode]
  const mappings: Array<[string, string, string]> = [
    ["GPIO0_IN", "GPIO0", "CLK_EXT_IN"],
    ["GPIO0_OUT", "GPIO0", "CLK_OUT"],
    ["GPIO16_OUT", "GPIO16", "CLK_OUT"],
    ["GPIO17_OUT", "GPIO17", "CLK_OUT"],
    ["GPIO2_OUT", "GPIO2", "CLK_OUT"], // the rule generalizes to any pin
    ["gpio17 out", "GPIO17", "CLK_OUT"], // upstream enum is case/space tolerant
  ];
  for (const [clkMode, pin, mode] of mappings) {
    it(`${clkMode} → clk {pin: ${pin}, mode: ${mode}} and removes clk_mode`, async () => {
      const { el, changes } = await mount("ethernet", { clk_mode: clkMode });
      el.shadowRoot!.querySelector<HTMLButtonElement>(".cta")!.click();
      expect(changes).toEqual([
        [
          { path: ["clk"], value: { pin, mode } },
          { path: ["clk_mode"], value: undefined },
        ],
      ]);
      expect(toast.success).toHaveBeenCalled();
    });
  }

  it("replaces an existing clk wholesale (upstream precedence)", async () => {
    const { el, changes } = await mount("ethernet", {
      clk_mode: "GPIO0_IN",
      clk: { pin: "GPIO17", mode: "CLK_OUT" },
    });
    el.shadowRoot!.querySelector<HTMLButtonElement>(".cta")!.click();
    expect(changes[0][0]).toEqual({
      path: ["clk"],
      value: { pin: "GPIO0", mode: "CLK_EXT_IN" },
    });
  });
});

describe("registry copy coverage", () => {
  // Every registry entry's copyPrefix must resolve to en.json copy, so a
  // future one-line rename entry can't ship with a typo'd or missing key.
  const device = (enMessages as { device: Record<string, string> }).device;
  const prefixes = [
    ...new Set(
      Object.values(DEPRECATED_OPTIONS)
        .flat()
        .map((o) => o.copyPrefix)
    ),
    "renamed_option",
  ];
  it.each(prefixes)("defines notice and migrate copy for %s", (prefix) => {
    expect(device[`${prefix}_notice`], `missing device.${prefix}_notice`).toBeTruthy();
    expect(device[`${prefix}_migrate`], `missing device.${prefix}_migrate`).toBeTruthy();
  });
});

describe("renamedOption", () => {
  const option = renamedOption("voc", "voc_index", "2026.8.0");

  it("targets the old key with shared templated copy", () => {
    expect(option.key).toBe("voc");
    expect(option.copyPrefix).toBe("renamed_option");
    expect(option.copyParams).toEqual({
      old: "voc",
      new: "voc_index",
      version: "2026.8.0",
    });
  });

  it("moves a scalar verbatim and removes the old key", () => {
    expect(option.migrate("high")).toEqual([
      { path: ["voc_index"], value: "high" },
      { path: ["voc"], value: undefined },
    ]);
  });

  it("moves a nested mapping verbatim", () => {
    const value = { name: "VOC", algorithm_tuning: { index_offset: 100 } };
    expect(option.migrate(value)).toEqual([
      { path: ["voc_index"], value },
      { path: ["voc"], value: undefined },
    ]);
  });

  it("hides the nudge for a not-materially-present value", () => {
    expect(option.migrate(undefined)).toBeNull();
    expect(option.migrate(null)).toBeNull();
    expect(option.migrate("")).toBeNull();
  });
});

describe("deprecation-notice — renamedOption entry end to end", () => {
  afterEach(() => {
    delete DEPRECATED_OPTIONS["sensor.testrename"];
  });

  it("renders with templated copy and emits the two-change rename", async () => {
    DEPRECATED_OPTIONS["sensor.testrename"] = [
      renamedOption("voc", "voc_index", "2026.8.0"),
    ];
    const { el, inner, changes } = await mount("sensor.testrename", {
      voc: { name: "VOC" },
      voc_index: { name: "stale" },
    });
    inner._localize = (key: string, params?: Record<string, unknown>) =>
      `${key}|${JSON.stringify(params)}`;
    await el.requestUpdate();
    const notice = el.shadowRoot!.querySelector(".notice");
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain(
      'device.renamed_option_notice|{"old":"voc","new":"voc_index","version":"2026.8.0"}'
    );
    el.shadowRoot!.querySelector<HTMLButtonElement>(".cta")!.click();
    // The old spelling wins over a pre-existing new key, mirroring clk.
    expect(changes).toEqual([
      [
        { path: ["voc_index"], value: { name: "VOC" } },
        { path: ["voc"], value: undefined },
      ],
    ]);
  });
});
