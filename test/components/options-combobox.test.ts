// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";

// happy-dom can't host webawesome's custom elements; we assert the
// component's own shadow-DOM markup (input + option rows).
vi.mock("@home-assistant/webawesome/dist/components/popup/popup.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/library.js", () => ({
  registerIconLibrary: () => {},
}));

import { OPTIONS_COMBOBOX_CHANGE_EVENT } from "../../src/components/options-combobox-event.js";
import { ESPHomeOptionsCombobox } from "../../src/components/options-combobox.js";

const OPTIONS = [
  { label: "afw121t", value: "afw121t" },
  { label: "bw12", value: "bw12" },
  { label: "bw15", value: "bw15" },
  { label: "rtl8710bn", value: "rtl8710bn" },
];

async function mount(value = "bw15") {
  const el = new ESPHomeOptionsCombobox();
  el.options = OPTIONS;
  el.value = value;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function input(el: ESPHomeOptionsCombobox): HTMLInputElement {
  return el.shadowRoot!.querySelector("input")!;
}

function options(el: ESPHomeOptionsCombobox): HTMLElement[] {
  return [...el.shadowRoot!.querySelectorAll<HTMLElement>(".option")];
}

/** Collect every change-event detail the element emits. */
function track(el: ESPHomeOptionsCombobox): string[] {
  const seen: string[] = [];
  el.addEventListener(OPTIONS_COMBOBOX_CHANGE_EVENT, (e) =>
    seen.push((e as CustomEvent).detail.value)
  );
  return seen;
}

async function open(el: ESPHomeOptionsCombobox) {
  input(el).dispatchEvent(new FocusEvent("focus"));
  await el.updateComplete;
}

describe("esphome-options-combobox", () => {
  test("closed field shows the committed value and no list", async () => {
    const el = await mount("bw15");
    expect(input(el).value).toBe("bw15");
    expect(options(el)).toHaveLength(0);
  });

  test("opening shows the full option list regardless of current value", async () => {
    const el = await mount("bw15");
    await open(el);
    expect(options(el).map((o) => o.textContent?.trim())).toEqual(
      OPTIONS.map((o) => o.label)
    );
  });

  test("opening preselects and highlights the current value", async () => {
    const el = await mount("bw15");
    await open(el);
    const opts = options(el);
    // bw15 is index 2 in OPTIONS — it opens active, not the top of the list.
    expect(opts[2].classList.contains("option--active")).toBe(true);
    expect(opts[2].getAttribute("aria-selected")).toBe("true");
    expect(input(el).getAttribute("aria-activedescendant")).toBe("option-2");
  });

  test("opening a free-text value not in the list highlights nothing", async () => {
    const el = await mount("cr3l");
    await open(el);
    expect(options(el).some((o) => o.classList.contains("option--active"))).toBe(false);
    expect(input(el).getAttribute("aria-activedescendant")).toBeNull();
  });

  test("typing filters to substring matches and emits the typed value", async () => {
    const el = await mount("bw15");
    const seen = track(el);
    await open(el);
    const field = input(el);
    field.value = "bw1";
    field.dispatchEvent(new Event("input"));
    await el.updateComplete;
    expect(options(el).map((o) => o.textContent?.trim())).toEqual(["bw12", "bw15"]);
    expect(seen[seen.length - 1]).toBe("bw1");
  });

  test("clicking an option emits its value and updates the field", async () => {
    const el = await mount("bw15");
    const seen = track(el);
    await open(el);
    options(el)[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await el.updateComplete;
    expect(seen[seen.length - 1]).toBe("afw121t");
    expect(el.value).toBe("afw121t");
    expect(input(el).value).toBe("afw121t");
    expect(options(el)).toHaveLength(0); // closed after select
  });

  test("ArrowDown then Enter moves from the preselected value and selects it", async () => {
    const el = await mount("bw15"); // index 2; opens active there
    const seen = track(el);
    await open(el);
    const field = input(el);
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
    );
    await el.updateComplete;
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await el.updateComplete;
    // ArrowDown advances from bw15 (2) to rtl8710bn (3).
    expect(seen[seen.length - 1]).toBe("rtl8710bn");
    expect(el.value).toBe("rtl8710bn");
  });

  test("Escape reverts the query and closes", async () => {
    const el = await mount("bw15");
    await open(el);
    const field = input(el);
    field.value = "zzz";
    field.dispatchEvent(new Event("input"));
    await el.updateComplete;
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await el.updateComplete;
    expect(options(el)).toHaveLength(0);
    expect(input(el).value).toBe("bw15");
  });

  test("Escape cancels the edit even when the host commits each keystroke", async () => {
    const el = await mount("bw15");
    // Mirror renderSelectField: every change is committed back to value.
    el.addEventListener(OPTIONS_COMBOBOX_CHANGE_EVENT, (e) => {
      el.value = (e as CustomEvent).detail.value;
    });
    await open(el);
    const field = input(el);
    field.value = "zz";
    field.dispatchEvent(new Event("input"));
    await el.updateComplete;
    expect(el.value).toBe("zz"); // host committed the typed text
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await el.updateComplete;
    expect(el.value).toBe("bw15"); // Escape restored & re-emitted the pre-edit value
    expect(input(el).value).toBe("bw15");
  });

  test("a custom value not in the list is kept and the list stays full on reopen", async () => {
    const el = await mount("cr3l"); // host already committed a free-text board
    expect(input(el).value).toBe("cr3l");
    await open(el);
    expect(options(el).map((o) => o.textContent?.trim())).toEqual(
      OPTIONS.map((o) => o.label)
    );
  });

  test("ArrowDown right after Escape activates the first option on one press", async () => {
    // Custom committed value matches no option, so a leftover _dirty would
    // make the post-Escape ArrowDown filter to an empty list and select nothing.
    const el = await mount("cr3l");
    await open(el);
    const field = input(el);
    field.value = "zz";
    field.dispatchEvent(new Event("input"));
    await el.updateComplete;
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await el.updateComplete;
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
    );
    await el.updateComplete;
    const opts = options(el);
    expect(opts).toHaveLength(OPTIONS.length);
    expect(opts[0].classList.contains("option--active")).toBe(true);
  });

  test("tags the default option with the muted note when opened", async () => {
    const el = await mount("");
    el.defaultValue = "bw15"; // index 2
    el.defaultNote = "default";
    await el.updateComplete;
    await open(el);
    const opts = options(el);
    const noteOf = (o: HTMLElement) =>
      o.querySelector(".option-default-note")?.textContent?.trim() ?? null;
    expect(noteOf(opts[2])).toBe("default");
    expect(opts.filter((o) => noteOf(o) !== null)).toHaveLength(1);
  });

  test("matches the default case-insensitively", async () => {
    const el = await mount("");
    el.defaultValue = "BW15";
    el.defaultNote = "default";
    await el.updateComplete;
    await open(el);
    expect(
      options(el)[2].querySelector(".option-default-note")?.textContent?.trim()
    ).toBe("default");
  });

  test("tags nothing without a default value or note", async () => {
    const el = await mount("");
    el.defaultNote = "default"; // value missing → no tag
    await el.updateComplete;
    await open(el);
    expect(el.shadowRoot!.querySelector(".option-default-note")).toBeNull();
  });

  test("renders an option's description as a quiet second line", async () => {
    const el = await mount("");
    el.options = [
      { label: "basic", value: "basic", description: "Reversible on every request." },
      { label: "digest", value: "digest" },
    ];
    await el.updateComplete;
    await open(el);
    const opts = options(el);
    expect(opts[0].querySelector(".option-description-note")?.textContent?.trim()).toBe(
      "Reversible on every request."
    );
    expect(opts[1].querySelector(".option-description-note")).toBeNull();
  });

  test("stacks the description with the default note on the default option", async () => {
    const el = await mount("");
    el.options = [
      { label: "basic", value: "basic", description: "Reversible on every request." },
    ];
    el.defaultValue = "basic";
    el.defaultNote = "default";
    await el.updateComplete;
    await open(el);
    const opt = options(el)[0];
    expect(opt.querySelector(".option-description-note")).not.toBeNull();
    expect(opt.querySelector(".option-default-note")?.textContent?.trim()).toBe(
      "default"
    );
  });

  test("typing filters on description text too", async () => {
    const el = await mount("");
    el.options = [
      { label: "basic", value: "basic", description: "Reversible on every request." },
      { label: "digest", value: "digest", description: "Sends only hashes." },
    ];
    await el.updateComplete;
    await open(el);
    const field = input(el);
    field.value = "hashes";
    field.dispatchEvent(new InputEvent("input"));
    await el.updateComplete;
    const opts = options(el);
    expect(opts).toHaveLength(1);
    expect(opts[0].querySelector(".option-label")?.textContent?.trim()).toBe("digest");
  });

  test("the change event is namespaced (no generic value-changed)", () => {
    expect(OPTIONS_COMBOBOX_CHANGE_EVENT).toBe("options-combobox-change");
  });

  test("invalid is exposed to assistive tech via aria-invalid", async () => {
    const el = await mount("bw15");
    expect(input(el).getAttribute("aria-invalid")).toBeNull();
    el.invalid = true;
    await el.updateComplete;
    expect(input(el).getAttribute("aria-invalid")).toBe("true");
  });

  test("aria-activedescendant never points past the rendered options", async () => {
    const el = await mount("bw15");
    await open(el);
    const field = input(el);
    // Opening preselects bw15 (index 2).
    expect(field.getAttribute("aria-activedescendant")).toBe("option-2");
    // Options shrink under the still-open list; the now-stale index must not
    // leak a reference to a non-existent row.
    el.options = [{ label: "afw121t", value: "afw121t" }];
    await el.updateComplete;
    expect(field.getAttribute("aria-activedescendant")).toBeNull();
  });

  test("mousedown inside the listbox doesn't blur the input", async () => {
    const el = await mount("bw15");
    await open(el);
    const listbox = el.shadowRoot!.querySelector("#listbox")!;
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    listbox.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true); // keeps focus so the popup stays open
  });
});
