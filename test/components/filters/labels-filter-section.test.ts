/**
 * @vitest-environment happy-dom
 *
 * Pins the labels section: rows with counts and chip styling,
 * ``labels-filter-change``, the empty-catalog state, and the
 * close-before-action ordering of the management request events.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import type { Label } from "../../../src/api/types/devices.js";
import { ESPHomeLabelsFilterSection } from "../../../src/components/filters/labels-filter-section.js";

const CATALOG: Label[] = [
  { id: "l1", name: "kitchen", color: "#ff0000" },
  { id: "l2", name: "outdoor", color: null },
] as Label[];

async function mount(
  overrides: Partial<Record<string, unknown>> = {}
): Promise<ESPHomeLabelsFilterSection> {
  const el = new ESPHomeLabelsFilterSection();
  el.expanded = true;
  // No context provider in the harness — drive the consumed state
  // directly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._catalog = CATALOG;
  Object.assign(el, overrides);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const rows = (el: ESPHomeLabelsFilterSection) => [
  ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".facet-row"),
];

function record(el: ESPHomeLabelsFilterSection, types: string[]): string[] {
  const order: string[] = [];
  for (const t of types) el.addEventListener(t, () => order.push(t));
  return order;
}

describe("esphome-labels-filter-section", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders one row per catalog label with usage counts and chip styling", async () => {
    const el = await mount({ usageCounts: { l1: 3 } });
    const [first, second] = rows(el);
    expect(first.querySelector(".label-chip")?.textContent?.trim()).toBe("kitchen");
    expect(first.querySelector(".facet-row-count")?.textContent?.trim()).toBe("3");
    expect(first.querySelector(".label-chip")?.getAttribute("style")).toContain(
      "#ff0000"
    );
    // Missing usage entries default to 0.
    expect(second.querySelector(".facet-row-count")?.textContent?.trim()).toBe("0");
  });

  it("emits labels-filter-change with the full new id set", async () => {
    const el = await mount({ selected: ["l1"] });
    const changes: string[][] = [];
    el.addEventListener("labels-filter-change", (e) =>
      changes.push((e as CustomEvent<string[]>).detail)
    );
    rows(el)[1].click();
    expect(changes).toEqual([["l1", "l2"]]);
    // The parent owns `selected`; deselecting against the un-updated
    // prop still emits the correct set relative to it.
    rows(el)[0].click();
    expect(changes[1]).toEqual([]);
  });

  it("shows the empty state and keeps the create CTA on an empty catalog", async () => {
    const el = await mount();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._catalog = [];
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".facet-empty")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".create-trigger")).not.toBeNull();
  });

  it("requests popover close before request-edit-label", async () => {
    const el = await mount();
    const order = record(el, ["request-popover-close", "request-edit-label"]);
    let detail: Label | undefined;
    el.addEventListener("request-edit-label", (e) => {
      detail = (e as CustomEvent<Label>).detail;
    });
    el.shadowRoot!.querySelector<HTMLButtonElement>(".row-action")!.click();
    expect(order).toEqual(["request-popover-close", "request-edit-label"]);
    expect(detail).toBe(CATALOG[0]);
  });

  it("requests popover close before request-delete-label", async () => {
    const el = await mount();
    const order = record(el, ["request-popover-close", "request-delete-label"]);
    let detail: Label | undefined;
    el.addEventListener("request-delete-label", (e) => {
      detail = (e as CustomEvent<Label>).detail;
    });
    el.shadowRoot!.querySelector<HTMLButtonElement>(".row-action--danger")!.click();
    expect(order).toEqual(["request-popover-close", "request-delete-label"]);
    expect(detail).toBe(CATALOG[0]);
  });

  it("requests popover close before request-create-label", async () => {
    const el = await mount();
    const order = record(el, ["request-popover-close", "request-create-label"]);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".create-trigger")!.click();
    expect(order).toEqual(["request-popover-close", "request-create-label"]);
  });

  it("row action clicks do not toggle the row's selection", async () => {
    const el = await mount();
    const changes: string[][] = [];
    el.addEventListener("labels-filter-change", (e) =>
      changes.push((e as CustomEvent<string[]>).detail)
    );
    el.shadowRoot!.querySelector<HTMLButtonElement>(".row-action")!.click();
    expect(changes).toEqual([]);
  });
});
