/**
 * @vitest-environment happy-dom
 *
 * Pins the deprecation nudge's registry contract: `renamedOption` one-liners,
 * shared copy coverage, and the migrate flow that emits `apply-section-values`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

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
