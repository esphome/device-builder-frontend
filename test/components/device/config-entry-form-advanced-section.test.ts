/**
 * @vitest-environment happy-dom
 *
 * advanced-section mode: basic fields, then a "Show advanced settings" switch,
 * then the advanced fields below it (revealed when on). All-advanced forms
 * render with no control by default (automation nodes); with gate-all-advanced
 * (the device section editor) they keep the control and stay collapsed. The
 * control emits ``advanced-toggle``.
 */
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/switch/switch.js", () => ({}));

import type { ConfigEntry } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { ESPHomeConfigEntryForm } from "../../../src/components/device/config-entry-form.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

const BASIC = makeConfigEntry({
  key: "name",
  type: ConfigEntryType.STRING,
  label: "Name Field",
});
const ADVANCED = makeConfigEntry({
  key: "reboot_timeout",
  type: ConfigEntryType.STRING,
  label: "Advanced Field",
  advanced: true,
});

function renderForm(
  entries: ConfigEntry[],
  opts: {
    showAdvanced?: boolean;
    values?: Record<string, unknown>;
    forceAdvancedControl?: boolean;
    gateAllAdvanced?: boolean;
  } = {}
): HTMLElement {
  const form = new ESPHomeConfigEntryForm();
  form.entries = entries;
  form.values = opts.values ?? {};
  form.advancedSection = true;
  form.showAdvanced = opts.showAdvanced ?? false;
  form.forceAdvancedControl = opts.forceAdvancedControl ?? false;
  form.gateAllAdvanced = opts.gateAllAdvanced ?? false;
  const container = document.createElement("div");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render((form as any).render(), container);
  return container;
}

function control(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(".advanced-toggle-row");
}

describe("config-entry-form advanced-section", () => {
  it("renders the control after basic fields, hides advanced until expanded", () => {
    const c = renderForm([BASIC, ADVANCED]);
    expect(control(c)).toBeTruthy();
    const text = c.textContent ?? "";
    expect(text).toContain("Name Field");
    expect(text).not.toContain("Advanced Field");
  });

  it("reveals advanced fields below the control when expanded", () => {
    const c = renderForm([BASIC, ADVANCED], { showAdvanced: true });
    const text = c.textContent ?? "";
    expect(text).toContain("Advanced Field");
    // control sits between the basic field and the advanced field
    const basicIdx = text.indexOf("Name Field");
    const ctrlIdx = text.indexOf("device.show_advanced");
    const advIdx = text.indexOf("Advanced Field");
    expect(basicIdx).toBeLessThan(ctrlIdx);
    expect(ctrlIdx).toBeLessThan(advIdx);
  });

  it("auto-opens and disables the switch when a pre-filled advanced field has a value", () => {
    const c = renderForm([BASIC, ADVANCED], { values: { reboot_timeout: "5min" } });
    expect((c.textContent ?? "").includes("Advanced Field")).toBe(true);
    // It can't be collapsed (a value is set), so the switch is non-interactive.
    expect(c.querySelector("wa-switch")!.hasAttribute("disabled")).toBe(true);
  });

  it("shows the control when the only advanced field is nested in a mixed group", () => {
    // The nested group is basic (so it stays in the basic list), but it holds an
    // advanced child — the control must surface or that child is unreachable.
    const nested = makeConfigEntry({
      key: "filters",
      type: ConfigEntryType.NESTED,
      label: "Filters",
      config_entries: [
        makeConfigEntry({
          key: "multiply",
          type: ConfigEntryType.STRING,
          label: "Multiply",
          advanced: true,
        }),
      ],
    });
    expect(control(renderForm([BASIC, nested]))).toBeTruthy();
  });

  it("keeps a recoverable control in an all-advanced form when external content is gated", () => {
    // The script editor sets force-advanced-control to gate its Parameters block
    // outside the form. The control must show, and must NOT auto-open: otherwise
    // the host's showAdvanced never flips and the external block is unreachable.
    const c = renderForm(
      [
        makeConfigEntry({
          key: "a",
          type: ConfigEntryType.STRING,
          label: "Only Advanced",
          advanced: true,
        }),
      ],
      { forceAdvancedControl: true }
    );
    expect(control(c)).toBeTruthy();
    expect((c.textContent ?? "").includes("Only Advanced")).toBe(false);
  });

  it("renders an all-advanced form with no control", () => {
    const c = renderForm([
      makeConfigEntry({
        key: "a",
        type: ConfigEntryType.STRING,
        label: "Only Advanced",
        advanced: true,
      }),
    ]);
    expect(control(c)).toBeNull();
    expect(c.textContent ?? "").toContain("Only Advanced");
  });

  it("gates an all-advanced form behind the control with gate-all-advanced", () => {
    // The device section editor sets gate-all-advanced so an all-advanced
    // component (captive_portal) shows just the control, fields hidden until
    // toggled — instead of the automation-node auto-open above.
    const onlyAdvanced = makeConfigEntry({
      key: "a",
      type: ConfigEntryType.STRING,
      label: "Only Advanced",
      advanced: true,
    });
    const collapsed = renderForm([onlyAdvanced], { gateAllAdvanced: true });
    expect(control(collapsed)).toBeTruthy();
    expect(collapsed.textContent ?? "").not.toContain("Only Advanced");
    const expanded = renderForm([onlyAdvanced], {
      gateAllAdvanced: true,
      showAdvanced: true,
    });
    expect(control(expanded)).toBeTruthy();
    expect(expanded.textContent ?? "").toContain("Only Advanced");
  });

  it("auto-opens a gated all-advanced form, locked, when a value is pre-filled", () => {
    // A pre-filled advanced value forces the section open even under
    // gate-all-advanced; the control stays visible but its switch is locked
    // (can't collapse while a value is set).
    const onlyAdvanced = makeConfigEntry({
      key: "a",
      type: ConfigEntryType.STRING,
      label: "Only Advanced",
      advanced: true,
    });
    const c = renderForm([onlyAdvanced], {
      gateAllAdvanced: true,
      values: { a: "set" },
    });
    expect(control(c)).toBeTruthy();
    expect(c.textContent ?? "").toContain("Only Advanced");
    expect(c.querySelector("wa-switch")!.hasAttribute("disabled")).toBe(true);
  });

  it("counts only rendered advanced fields, not hidden ones, in the control label", () => {
    // captive_portal shape: two shown advanced fields + one advanced+hidden
    // field (setup_priority) that renders nothing. The "(N)" count must be 2.
    const form = new ESPHomeConfigEntryForm();
    form.entries = [
      makeConfigEntry({
        key: "a",
        type: ConfigEntryType.STRING,
        label: "Adv A",
        advanced: true,
      }),
      makeConfigEntry({
        key: "b",
        type: ConfigEntryType.STRING,
        label: "Adv B",
        advanced: true,
      }),
      makeConfigEntry({
        key: "setup_priority",
        type: ConfigEntryType.STRING,
        label: "Hidden Adv",
        advanced: true,
        hidden: true,
      }),
    ];
    form.values = {};
    form.advancedSection = true;
    form.gateAllAdvanced = true;
    form.showAdvanced = true;
    // Default _localize returns the key; interpolate so the count is observable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any)._localize = (key: string, params?: { count?: number }) =>
      key === "device.show_advanced_count"
        ? `Show advanced settings (${params?.count})`
        : key;
    const container = document.createElement("div");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render((form as any).render(), container);
    const text = container.textContent ?? "";
    expect(text).toContain("Show advanced settings (2)");
    expect(text).not.toContain("Show advanced settings (3)");
    expect(text).toContain("Adv A");
    expect(text).toContain("Adv B");
    expect(text).not.toContain("Hidden Adv");
  });

  it("counts a constraint cluster as one advanced unit, not per member", () => {
    // Two advanced fields sharing an inclusive group fold into one cluster box
    // painted at the first member's slot; the "(N)" count must be 1, not 2.
    const form = new ESPHomeConfigEntryForm();
    form.entries = [
      makeConfigEntry({
        key: "a",
        type: ConfigEntryType.STRING,
        label: "Clu A",
        advanced: true,
        group: "grp",
      }),
      makeConfigEntry({
        key: "b",
        type: ConfigEntryType.STRING,
        label: "Clu B",
        advanced: true,
        group: "grp",
      }),
    ];
    form.values = {};
    form.advancedSection = true;
    form.gateAllAdvanced = true;
    form.showAdvanced = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any)._localize = (key: string, params?: { count?: number }) =>
      key === "device.show_advanced_count"
        ? `Show advanced settings (${params?.count})`
        : key;
    const container = document.createElement("div");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render((form as any).render(), container);
    const text = container.textContent ?? "";
    expect(text).toContain("Show advanced settings (1)");
    expect(text).not.toContain("Show advanced settings (2)");
  });

  it("does not count a constraint cluster whose members are all gated off", () => {
    // The cluster renderer paints nothing when every member is hidden/gated, so
    // it must not add to the count. One shown advanced field + a fully-hidden
    // cluster ⇒ count is 1, not 2.
    const form = new ESPHomeConfigEntryForm();
    form.entries = [
      makeConfigEntry({
        key: "shown",
        type: ConfigEntryType.STRING,
        label: "Shown Adv",
        advanced: true,
      }),
      makeConfigEntry({
        key: "g1",
        type: ConfigEntryType.STRING,
        label: "Gated 1",
        advanced: true,
        group: "grp",
        hidden: true,
      }),
      makeConfigEntry({
        key: "g2",
        type: ConfigEntryType.STRING,
        label: "Gated 2",
        advanced: true,
        group: "grp",
        hidden: true,
      }),
    ];
    form.values = {};
    form.advancedSection = true;
    form.gateAllAdvanced = true;
    form.showAdvanced = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any)._localize = (key: string, params?: { count?: number }) =>
      key === "device.show_advanced_count"
        ? `Show advanced settings (${params?.count})`
        : key;
    const container = document.createElement("div");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render((form as any).render(), container);
    const text = container.textContent ?? "";
    expect(text).toContain("Show advanced settings (1)");
    expect(text).not.toContain("Show advanced settings (2)");
    expect(text).toContain("Shown Adv");
    expect(text).not.toContain("Gated");
  });

  it("auto-opens an off-flag form whose only painting unit is advanced", () => {
    // A non-painting basic unit (hidden, no value) alongside a painting advanced
    // field is effectively all-advanced: an automation node (gate off) should
    // auto-open it inline rather than gate the only visible field behind a
    // control. The non-painting basic must not keep basic.length > 0.
    const form = new ESPHomeConfigEntryForm();
    form.entries = [
      makeConfigEntry({
        key: "hidden_basic",
        type: ConfigEntryType.STRING,
        label: "Hidden Basic",
        hidden: true,
      }),
      makeConfigEntry({
        key: "adv",
        type: ConfigEntryType.STRING,
        label: "Adv Field",
        advanced: true,
      }),
    ];
    form.values = {};
    form.advancedSection = true;
    form.gateAllAdvanced = false;
    form.showAdvanced = false;
    const container = document.createElement("div");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render((form as any).render(), container);
    // All-advanced auto-open: no control, the advanced field paints inline.
    expect(control(container)).toBeNull();
    expect(container.textContent ?? "").toContain("Adv Field");
    expect(container.textContent ?? "").not.toContain("Hidden Basic");
  });

  it("emits advanced-toggle when the control is clicked", () => {
    const form = new ESPHomeConfigEntryForm();
    form.entries = [BASIC, ADVANCED];
    form.values = {};
    form.advancedSection = true;
    form.showAdvanced = false;
    const container = document.createElement("div");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render((form as any).render(), container);
    let detail: { show: boolean } | null = null;
    // The control dispatches on the form element (its host), not the switch.
    form.addEventListener("advanced-toggle", (e) => {
      detail = (e as CustomEvent<{ show: boolean }>).detail;
    });
    const sw = container.querySelector<HTMLElement & { checked: boolean }>("wa-switch")!;
    sw.checked = true;
    sw.dispatchEvent(new Event("change"));
    expect(detail).toEqual({ show: true });
  });
});
