/**
 * @vitest-environment happy-dom
 *
 * Pins <esphome-navigator-search>'s own interactive contract: the
 * ``navigator-search`` payload shape, Escape-to-clear (gated on a
 * non-empty value), and that clearing zeroes ``value`` before emitting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeNavigatorSearch } from "../../../src/components/device/device-navigator-search.js";

let el: ESPHomeNavigatorSearch;
let events: Array<{ value: string }>;

async function mount(value = ""): Promise<void> {
  el = new ESPHomeNavigatorSearch();
  el.value = value;
  events = [];
  el.addEventListener("navigator-search", (e) => events.push((e as CustomEvent).detail));
  document.body.appendChild(el);
  await el.updateComplete;
}

const input = () => el.shadowRoot!.querySelector("input")!;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("esphome-navigator-search", () => {
  beforeEach(() => mount());

  it("emits navigator-search { value } and self-syncs value on input", async () => {
    input().value = "clamp";
    input().dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    expect(events).toEqual([{ value: "clamp" }]);
    expect(el.value).toBe("clamp");
  });

  it("clears in place on Escape and zeroes value first", async () => {
    el.value = "clamp";
    await el.updateComplete;
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(el.value).toBe("");
    expect(events[events.length - 1]).toEqual({ value: "" });
  });

  it("ignores Escape when the value is already empty", async () => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(events).toHaveLength(0);
  });

  it("clears via the clear button and emits an empty value", async () => {
    el.value = "clamp";
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLButtonElement>(".search-clear")!.click();
    expect(el.value).toBe("");
    expect(events[events.length - 1]).toEqual({ value: "" });
  });
});
