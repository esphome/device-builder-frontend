// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";

// happy-dom can't host webawesome's custom elements; we assert the
// component's own shadow-DOM markup (input + option rows).
vi.mock("@home-assistant/webawesome/dist/components/popup/popup.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/library.js", () => ({
  registerIconLibrary: () => {},
}));

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

/** Collect every value-changed detail the element emits. */
function track(el: ESPHomeOptionsCombobox): string[] {
  const seen: string[] = [];
  el.addEventListener("value-changed", (e) => seen.push((e as CustomEvent).detail.value));
  return seen;
}

async function open(el: ESPHomeOptionsCombobox) {
  input(el).dispatchEvent(new FocusEvent("focus"));
  await el.updateComplete;
}

afterEach(() => {
  document.body.innerHTML = "";
});

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

  test("ArrowDown then Enter selects the active option", async () => {
    const el = await mount("bw15");
    const seen = track(el);
    await open(el);
    const field = input(el);
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
    );
    await el.updateComplete;
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await el.updateComplete;
    expect(seen[seen.length - 1]).toBe("afw121t");
    expect(el.value).toBe("afw121t");
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
    // Mirror renderSelectField: every value-changed is committed back to value.
    el.addEventListener("value-changed", (e) => {
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
});
