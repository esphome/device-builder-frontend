/**
 * @vitest-environment happy-dom
 *
 * advanced-section mode: basic fields, then a "Show advanced settings" switch,
 * then the advanced fields below it (revealed when on). All-advanced forms
 * render with no control by default (automation nodes). With gate-advanced (the
 * device section editor) the YAML-present fields — basic or advanced — paint
 * inline, and only the empty advanced fields stay behind the control (off by
 * default, a real unlocked switch). The control emits ``advanced-toggle``.
 */
import { render } from "lit";
import { describe, expect, it, onTestFinished, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/switch/switch.js", () => ({}));

import type { ConfigEntry } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import {
  ADVANCED_ANCHOR_TTL_MS,
  ESPHomeConfigEntryForm,
} from "../../../src/components/device/config-entry-form.js";
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
    gateAdvanced?: boolean;
  } = {}
): HTMLElement {
  const form = new ESPHomeConfigEntryForm();
  form.entries = entries;
  form.values = opts.values ?? {};
  form.advancedSection = true;
  form.showAdvanced = opts.showAdvanced ?? false;
  form.forceAdvancedControl = opts.forceAdvancedControl ?? false;
  form.gateAdvanced = opts.gateAdvanced ?? false;
  const container = document.createElement("div");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render((form as any).render(), container);
  return container;
}

function control(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(".advanced-toggle-row");
}

/** Stub the form's localizer so the control's "(N)" count is observable. */
function stubCountLocalize(form: ESPHomeConfigEntryForm): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (form as any)._localize = (key: string, params?: { count?: number }) =>
    key === "device.show_advanced_count"
      ? `Show advanced settings (${params?.count})`
      : key;
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

  it("gates an all-advanced form behind the control with gate-advanced", () => {
    // The device section editor sets gate-advanced so an all-advanced
    // component (captive_portal) shows just the control, fields hidden until
    // toggled — instead of the automation-node auto-open above.
    const onlyAdvanced = makeConfigEntry({
      key: "a",
      type: ConfigEntryType.STRING,
      label: "Only Advanced",
      advanced: true,
    });
    const collapsed = renderForm([onlyAdvanced], { gateAdvanced: true });
    expect(control(collapsed)).toBeTruthy();
    expect(collapsed.textContent ?? "").not.toContain("Only Advanced");
    const expanded = renderForm([onlyAdvanced], {
      gateAdvanced: true,
      showAdvanced: true,
    });
    expect(control(expanded)).toBeTruthy();
    expect(expanded.textContent ?? "").toContain("Only Advanced");
  });

  it("surfaces a pre-filled advanced field inline under gate-advanced, switch unlocked", () => {
    // A YAML-present advanced field paints inline (not gated); the switch is a
    // real toggle, never locked open, and it isn't forced on.
    const onlyAdvanced = makeConfigEntry({
      key: "a",
      type: ConfigEntryType.STRING,
      label: "Only Advanced",
      advanced: true,
    });
    const c = renderForm([onlyAdvanced], {
      gateAdvanced: true,
      values: { a: "set" },
    });
    expect(c.textContent ?? "").toContain("Only Advanced");
    const sw = c.querySelector("wa-switch");
    // The only advanced field is pre-filled, so nothing is gated — the control
    // may or may not paint, but if it does its switch must be unlocked and off.
    if (sw) {
      expect(sw.hasAttribute("disabled")).toBe(false);
      expect((sw as HTMLElement & { checked?: boolean }).checked ?? false).toBe(false);
    }
  });

  it("shows only YAML-present advanced fields, gating the empty ones, under gate-advanced", () => {
    // The starter-kit switch.gpio shape: basic fields, one pre-filled advanced
    // field (id/internal), and several empty advanced fields. Only the filled
    // one surfaces; the empty ones stay behind the control, off by default —
    // one filled advanced field must NOT drag the rest on screen.
    const entries = [
      makeConfigEntry({ key: "name", type: ConfigEntryType.STRING, label: "Name Field" }),
      makeConfigEntry({
        key: "internal",
        type: ConfigEntryType.STRING,
        label: "Internal Field",
        advanced: true,
      }),
      makeConfigEntry({
        key: "command_retain",
        type: ConfigEntryType.STRING,
        label: "Empty Adv One",
        advanced: true,
      }),
      makeConfigEntry({
        key: "device_id",
        type: ConfigEntryType.STRING,
        label: "Empty Adv Two",
        advanced: true,
      }),
    ];
    const c = renderForm(entries, {
      gateAdvanced: true,
      values: { name: "sw", internal: "true" },
    });
    const text = c.textContent ?? "";
    expect(text).toContain("Name Field");
    expect(text).toContain("Internal Field"); // YAML-present advanced → inline
    expect(text).not.toContain("Empty Adv One");
    expect(text).not.toContain("Empty Adv Two");
    const sw = c.querySelector<HTMLElement & { checked?: boolean }>("wa-switch")!;
    expect(sw.hasAttribute("disabled")).toBe(false);
    expect(sw.checked ?? false).toBe(false);
  });

  it("counts only the gated (empty) advanced fields, not the inline ones", () => {
    // Under gate-advanced, the "(N)" count is the empty advanced fields the
    // toggle reveals; the pre-filled advanced field is already shown inline.
    const form = new ESPHomeConfigEntryForm();
    form.entries = [
      makeConfigEntry({
        key: "internal",
        type: ConfigEntryType.STRING,
        label: "Filled Adv",
        advanced: true,
      }),
      makeConfigEntry({
        key: "command_retain",
        type: ConfigEntryType.STRING,
        label: "Empty Adv One",
        advanced: true,
      }),
      makeConfigEntry({
        key: "device_id",
        type: ConfigEntryType.STRING,
        label: "Empty Adv Two",
        advanced: true,
      }),
    ];
    form.values = { internal: "true" };
    form.advancedSection = true;
    form.gateAdvanced = true;
    form.showAdvanced = false;
    stubCountLocalize(form);
    const container = document.createElement("div");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render((form as any).render(), container);
    const text = container.textContent ?? "";
    expect(text).toContain("Show advanced settings (2)");
    expect(text).not.toContain("Show advanced settings (3)");
    expect(text).toContain("Filled Adv");
  });

  it("reveals the gated advanced fields when the toggle is turned on", () => {
    const entries = [
      makeConfigEntry({ key: "name", type: ConfigEntryType.STRING, label: "Name Field" }),
      makeConfigEntry({
        key: "internal",
        type: ConfigEntryType.STRING,
        label: "Internal Field",
        advanced: true,
      }),
      makeConfigEntry({
        key: "command_retain",
        type: ConfigEntryType.STRING,
        label: "Empty Adv",
        advanced: true,
      }),
    ];
    const c = renderForm(entries, {
      gateAdvanced: true,
      showAdvanced: true,
      values: { name: "sw", internal: "true" },
    });
    const text = c.textContent ?? "";
    expect(text).toContain("Internal Field");
    expect(text).toContain("Empty Adv");
  });

  it("counts a pre-filled constraint-cluster member as inline, not gated", () => {
    // Two advanced fields sharing an inclusive group fold into one cluster box.
    // A value on either member makes the cluster YAML-present, so it paints
    // inline and is not counted behind the control.
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
      makeConfigEntry({
        key: "empty",
        type: ConfigEntryType.STRING,
        label: "Empty Adv",
        advanced: true,
      }),
    ];
    form.values = { a: "set" };
    form.advancedSection = true;
    form.gateAdvanced = true;
    form.showAdvanced = false;
    stubCountLocalize(form);
    const container = document.createElement("div");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render((form as any).render(), container);
    const text = container.textContent ?? "";
    // The pre-filled cluster surfaces inline; only the lone empty field is gated.
    expect(text).toContain("Clu A");
    expect(text).toContain("Show advanced settings (1)");
    expect(text).not.toContain("Show advanced settings (2)");
    expect(text).not.toContain("Empty Adv");
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
    form.gateAdvanced = true;
    form.showAdvanced = true;
    stubCountLocalize(form);
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
    form.gateAdvanced = true;
    form.showAdvanced = true;
    stubCountLocalize(form);
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
    form.gateAdvanced = true;
    form.showAdvanced = true;
    stubCountLocalize(form);
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
    form.gateAdvanced = false;
    form.showAdvanced = false;
    const container = document.createElement("div");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render((form as any).render(), container);
    // All-advanced auto-open: no control, the advanced field paints inline.
    expect(control(container)).toBeNull();
    expect(container.textContent ?? "").toContain("Adv Field");
    expect(container.textContent ?? "").not.toContain("Hidden Basic");
  });

  it("does not force the section open under gate-advanced when a pre-filled advanced field exists", () => {
    // The bug: the form's updated() mirrors force-open onto the host by emitting
    // advanced-toggle(true), which flips showAdvanced and reveals every empty
    // advanced field. Under gate-advanced the pre-filled field paints inline, so
    // the form must NOT emit — the toggle stays off.
    const form = new ESPHomeConfigEntryForm();
    form.entries = [ADVANCED];
    form.values = { reboot_timeout: "5min" };
    form.advancedSection = true;
    form.gateAdvanced = true;
    form.showAdvanced = false;
    let emitted = false;
    form.addEventListener("advanced-toggle", () => {
      emitted = true;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any).updated(new Map());
    expect(emitted).toBe(false);
  });

  it("still force-opens (emits advanced-toggle) without gate-advanced", () => {
    // Automation / script hosts keep the mirror: a pre-filled advanced field
    // emits advanced-toggle(true) so an externally-gated sibling tracks the open
    // section.
    const form = new ESPHomeConfigEntryForm();
    form.entries = [ADVANCED];
    form.values = { reboot_timeout: "5min" };
    form.advancedSection = true;
    form.gateAdvanced = false;
    form.showAdvanced = false;
    let detail: { show: boolean } | null = null;
    form.addEventListener("advanced-toggle", (e) => {
      detail = (e as CustomEvent<{ show: boolean }>).detail;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any).updated(new Map());
    expect(detail).toEqual({ show: true });
  });

  it("asks the host to open the section once when the cursor targets a hidden advanced field", () => {
    const form = new ESPHomeConfigEntryForm();
    form.entries = [BASIC, ADVANCED];
    form.values = {};
    form.advancedSection = true;
    form.showAdvanced = false;
    form.focusFieldPath = ["reboot_timeout"];
    let count = 0;
    form.addEventListener("advanced-toggle", () => count++);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any).updated(new Map());
    expect(count).toBe(1);
    // One-shot: a host decline (or a deliberate re-collapse) sticks.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any).updated(new Map());
    expect(count).toBe(1);
  });

  it("does not ask for a basic-field focus target", () => {
    const form = new ESPHomeConfigEntryForm();
    form.entries = [BASIC, ADVANCED];
    form.values = {};
    form.advancedSection = true;
    form.showAdvanced = false;
    form.focusFieldPath = ["name"];
    let emitted = false;
    form.addEventListener("advanced-toggle", () => {
      emitted = true;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any).updated(new Map());
    expect(emitted).toBe(false);
  });

  it("holds the focus-reveal shot until entries land", () => {
    // The path can arrive before the async catalog; the target must not be
    // consumed against an empty schema.
    const form = new ESPHomeConfigEntryForm();
    form.entries = [];
    form.values = {};
    form.advancedSection = true;
    form.showAdvanced = false;
    form.focusFieldPath = ["reboot_timeout"];
    let count = 0;
    form.addEventListener("advanced-toggle", () => count++);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any).updated(new Map());
    expect(count).toBe(0);
    form.entries = [BASIC, ADVANCED];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any).updated(new Map());
    expect(count).toBe(1);
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

  // Placement freeze while open (#1977): a value landing mid-edit must not
  // re-home the field above the switch; live classification resumes on close.
  function gatedOpenForm(values: Record<string, unknown>) {
    const form = new ESPHomeConfigEntryForm();
    form.entries = [
      makeConfigEntry({
        key: "internal",
        type: ConfigEntryType.STRING,
        label: "Filled Adv",
        advanced: true,
      }),
      makeConfigEntry({
        key: "show_test_card",
        type: ConfigEntryType.BOOLEAN,
        label: "Test Card",
        advanced: true,
      }),
      makeConfigEntry({
        key: "command_retain",
        type: ConfigEntryType.STRING,
        label: "Empty Adv",
        advanced: true,
      }),
    ];
    form.values = values;
    form.advancedSection = true;
    form.gateAdvanced = true;
    form.showAdvanced = true;
    stubCountLocalize(form);
    const container = document.createElement("div");
    const paint = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render((form as any).render(), container);
      return container.textContent ?? "";
    };
    return { form, paint };
  }

  it("keeps a field filled while the section is open below the control", () => {
    const { form, paint } = gatedOpenForm({ internal: "x" });
    let text = paint();
    expect(text.indexOf("Filled Adv")).toBeLessThan(text.indexOf("Show advanced"));
    expect(text.indexOf("Show advanced")).toBeLessThan(text.indexOf("Test Card"));
    expect(text).toContain("Show advanced settings (2)");
    form.values = { ...form.values, show_test_card: true };
    text = paint();
    expect(text.indexOf("Show advanced")).toBeLessThan(text.indexOf("Test Card"));
    expect(text).toContain("Show advanced settings (2)");
  });

  it("re-homes a mid-open filled field inline once the toggle turns off", () => {
    const { form, paint } = gatedOpenForm({});
    paint();
    form.values = { show_test_card: true };
    paint();
    form.showAdvanced = false;
    const text = paint();
    expect(text).toContain("Test Card");
    expect(text.indexOf("Test Card")).toBeLessThan(text.indexOf("Show advanced"));
    expect(text).toContain("Show advanced settings (2)");
    expect(text).not.toContain("Empty Adv");
    // willUpdate's close-clear dropped the mid-open placement, so reopening
    // re-freezes from the current values: the filled field is now inline.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any).willUpdate(new Map([["showAdvanced", true]]));
    form.showAdvanced = true;
    const reopened = paint();
    expect(reopened.indexOf("Test Card")).toBeLessThan(reopened.indexOf("Show advanced"));
    expect(reopened).toContain("Show advanced settings (2)");
  });

  // Toggle scroll anchor (#1977): flipping the control reveals nested
  // advanced children in place ABOVE it, so the row's viewport position is
  // captured at click time and the scroll container compensated after the
  // ``showAdvanced`` re-render. wa-* controls can't mount under happy-dom,
  // so geometry is stubbed and each half is driven directly.
  const ROW_TOP = 500;
  const ROW_TOP_AFTER = 900; // re-render grew content above the control
  function anchoredControl(rowTop: number) {
    const form = new ESPHomeConfigEntryForm();
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    Object.defineProperties(scroller, {
      scrollHeight: { value: 1000 },
      clientHeight: { value: 300 },
    });
    document.body.appendChild(scroller);
    onTestFinished(() => scroller.remove());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render((form as any)._renderAdvancedControl(false, 2, false), scroller);
    const row = scroller.querySelector<HTMLElement>(".advanced-toggle-row")!;
    row.getBoundingClientRect = () => ({ top: rowTop }) as DOMRect;
    // The restore path resolves the row through the form's shadow root;
    // without a mount, point it at the rendered fragment.
    Object.defineProperty(form, "shadowRoot", { value: scroller });
    const sw = row.querySelector<HTMLElement>("wa-switch")!;
    return { form, scroller, row, sw };
  }

  it("compensates the scroll container so the toggled control stays put", () => {
    const { form, scroller, row, sw } = anchoredControl(ROW_TOP);
    sw.dispatchEvent(new Event("change"));
    row.getBoundingClientRect = () => ({ top: ROW_TOP_AFTER }) as DOMRect;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any)._restoreAdvancedControlAnchor(new Map([["showAdvanced", false]]));
    expect(scroller.scrollTop).toBe(ROW_TOP_AFTER - ROW_TOP);
    // Consumed: a second showAdvanced change must not re-scroll.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any)._restoreAdvancedControlAnchor(new Map([["showAdvanced", true]]));
    expect(scroller.scrollTop).toBe(ROW_TOP_AFTER - ROW_TOP);
  });

  it("holds the anchor for a showAdvanced change and ignores a stale one", () => {
    const { form, scroller, row, sw } = anchoredControl(ROW_TOP);
    sw.dispatchEvent(new Event("change"));
    row.getBoundingClientRect = () => ({ top: ROW_TOP_AFTER }) as DOMRect;
    // Unrelated update: no scroll, anchor kept for the real toggle render.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any)._restoreAdvancedControlAnchor(new Map([["values", {}]]));
    expect(scroller.scrollTop).toBe(0);
    // Expired anchor: consumed without scrolling.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any)._advancedControlAnchor = {
      top: ROW_TOP,
      at: performance.now() - ADVANCED_ANCHOR_TTL_MS - 1,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any)._restoreAdvancedControlAnchor(new Map([["showAdvanced", false]]));
    expect(scroller.scrollTop).toBe(0);
  });
});
