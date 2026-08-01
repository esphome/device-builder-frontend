/**
 * @vitest-environment happy-dom
 *
 * Pins the name_add_mac_suffix nudge: the draft line scan, the
 * turn-off rewrite, the CTA event, dismissal, and live clearing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeMacSuffixNotice } from "../../../src/components/device/mac-suffix-notice.js";
import {
  disableMacSuffixInYaml,
  findTruthyMacSuffixLine,
} from "../../../src/util/yaml-mac-suffix.js";

const SUFFIXED = "esphome:\n  name: kit\n  name_add_mac_suffix: true\nwifi:\n";
const ADOPTED = "esphome:\n  name: kit-aabbcc\n  name_add_mac_suffix: false\nwifi:\n";
const PLAIN = "esphome:\n  name: kit\nwifi:\n";

async function mount(yaml: string): Promise<ESPHomeMacSuffixNotice> {
  const el = new ESPHomeMacSuffixNotice();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._localize = (key: string) => key;
  el.configuration = "kitchen.yaml";
  el.yaml = yaml;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("findTruthyMacSuffixLine", () => {
  it("finds truthy spellings as a direct child of esphome", () => {
    expect(findTruthyMacSuffixLine(SUFFIXED)).toBe(2);
    expect(findTruthyMacSuffixLine("esphome:\n  name_add_mac_suffix: On\n")).toBe(1);
    expect(findTruthyMacSuffixLine('esphome:\n  name_add_mac_suffix: "yes"\n')).toBe(1);
    expect(findTruthyMacSuffixLine("esphome:\n  name_add_mac_suffix: enable\n")).toBe(1);
  });

  it("ignores false, absence, other sections, and deeper nesting", () => {
    expect(findTruthyMacSuffixLine(ADOPTED)).toBe(-1);
    expect(findTruthyMacSuffixLine(PLAIN)).toBe(-1);
    expect(findTruthyMacSuffixLine("web_server:\n  name_add_mac_suffix: true\n")).toBe(
      -1
    );
    expect(
      findTruthyMacSuffixLine("esphome:\n  project:\n    name_add_mac_suffix: true\n")
    ).toBe(-1);
  });

  it("follows YAML last-key-wins for duplicate keys mid-edit", () => {
    expect(
      findTruthyMacSuffixLine(
        "esphome:\n  name_add_mac_suffix: true\n  name_add_mac_suffix: false\n"
      )
    ).toBe(-1);
    expect(
      findTruthyMacSuffixLine(
        "esphome:\n  name_add_mac_suffix: false\n  name_add_mac_suffix: true\n"
      )
    ).toBe(2);
  });
});

describe("disableMacSuffixInYaml", () => {
  it("rewrites the value in place, keeping a trailing comment", () => {
    expect(disableMacSuffixInYaml(SUFFIXED)).toBe(
      "esphome:\n  name: kit\n  name_add_mac_suffix: false\nwifi:\n"
    );
    expect(
      disableMacSuffixInYaml("esphome:\n  name_add_mac_suffix: true # factory\n")
    ).toBe("esphome:\n  name_add_mac_suffix: false # factory\n");
  });

  it("returns null when the flag isn't set", () => {
    expect(disableMacSuffixInYaml(ADOPTED)).toBeNull();
    expect(disableMacSuffixInYaml(PLAIN)).toBeNull();
  });
});

describe("mac-suffix-notice", () => {
  it("renders for a truthy flag, with the docs link", async () => {
    const el = await mount(SUFFIXED);
    const notice = el.shadowRoot!.querySelector(".notice");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("device.mac_suffix_notice");
    expect(notice?.querySelector("a")?.href).toContain("device-builder#device-status");
  });

  it("stays hidden for false or absent", async () => {
    expect((await mount(ADOPTED)).shadowRoot!.querySelector(".notice")).toBeNull();
    expect((await mount(PLAIN)).shadowRoot!.querySelector(".notice")).toBeNull();
  });

  it("clears live when the draft turns the flag off", async () => {
    const el = await mount(SUFFIXED);
    expect(el.shadowRoot!.querySelector(".notice")).not.toBeNull();
    el.yaml = ADOPTED;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".notice")).toBeNull();
  });

  it("emits request-disable-mac-suffix from the CTA", async () => {
    const el = await mount(SUFFIXED);
    const seen = vi.fn();
    el.addEventListener("request-disable-mac-suffix", seen);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".cta")?.click();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("clears immediately after Turn off even while the backend flag lags", async () => {
    const el = new ESPHomeMacSuffixNotice();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._localize = (key: string) => key;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._devices = [{ configuration: "kitchen.yaml", name_add_mac_suffix: true }];
    el.configuration = "kitchen.yaml";
    el.yaml = ADOPTED;
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".notice")).toBeNull();
  });

  it("falls back to the backend flag without a CTA when the scan can't see it", async () => {
    for (const yaml of [
      "packages:\n  fleet: !include common.yaml\n",
      "esphome:\n  name_add_mac_suffix: ${suffix}\n",
    ]) {
      const el = new ESPHomeMacSuffixNotice();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any)._localize = (key: string) => key;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any)._devices = [
        { configuration: "kitchen.yaml", name_add_mac_suffix: true },
      ];
      el.configuration = "kitchen.yaml";
      el.yaml = yaml;
      document.body.appendChild(el);
      await el.updateComplete;
      const notice = el.shadowRoot!.querySelector(".notice");
      expect(notice).not.toBeNull();
      expect(notice!.querySelector(".cta")).toBeNull();
      el.remove();
    }
  });

  it("hides after dismiss and un-dismisses on a configuration switch", async () => {
    const el = await mount(SUFFIXED);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".notice-close")?.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".notice")).toBeNull();
    el.configuration = "other.yaml";
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".notice")).not.toBeNull();
  });
});
