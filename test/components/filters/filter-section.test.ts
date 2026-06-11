/**
 * @vitest-environment happy-dom
 *
 * Pins the generic section: header state + count chip, body gated on
 * ``expanded`` (never self-flipped), ``facet-change`` payloads, and
 * search filtering with its empty states and reset-on-collapse.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeFilterSection } from "../../../src/components/filters/filter-section.js";
import type { FacetOption } from "../../../src/util/facets.js";

const OPTIONS: FacetOption[] = [
  { id: "esp32", name: "esp32", count: 3 },
  { id: "esp8266", name: "esp8266", count: 1 },
  { id: "rp2040", name: "rp2040", count: -1 },
];

async function mount(
  overrides: Partial<ESPHomeFilterSection> = {}
): Promise<ESPHomeFilterSection> {
  const el = new ESPHomeFilterSection();
  el.name = "Platform";
  el.options = OPTIONS;
  Object.assign(el, overrides);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const header = (el: ESPHomeFilterSection) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(".section-header")!;
const body = (el: ESPHomeFilterSection) => el.shadowRoot!.querySelector(".section-body");
const rows = (el: ESPHomeFilterSection) => [
  ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".facet-row"),
];

describe("esphome-filter-section", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders collapsed by default with aria-expanded false", async () => {
    const el = await mount();
    expect(header(el).getAttribute("aria-expanded")).toBe("false");
    expect(body(el)).toBeNull();
  });

  it("renders the body when expanded", async () => {
    const el = await mount({ expanded: true });
    expect(header(el).getAttribute("aria-expanded")).toBe("true");
    expect(body(el)).not.toBeNull();
    expect(rows(el)).toHaveLength(3);
  });

  it("emits filter-section-toggle from the header without flipping expanded", async () => {
    const el = await mount();
    const onToggle = vi.fn();
    el.addEventListener("filter-section-toggle", onToggle);
    header(el).click();
    await el.updateComplete;
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(el.expanded).toBe(false);
  });

  it("shows the selection count chip only when selections exist", async () => {
    const el = await mount();
    expect(el.shadowRoot!.querySelector(".section-count")).toBeNull();
    el.selected = ["esp32", "esp8266"];
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".section-count")?.textContent?.trim()).toBe("2");
  });

  it("emits facet-change with the full new id set on row toggle", async () => {
    const el = await mount({ expanded: true, selected: ["esp32"] });
    const changes: string[][] = [];
    el.addEventListener("facet-change", (e) =>
      changes.push((e as CustomEvent<string[]>).detail)
    );

    rows(el)[1].click();
    expect(changes).toEqual([["esp32", "esp8266"]]);

    rows(el)[0].click();
    expect(changes[1]).toEqual([]);
  });

  it("marks selected rows checked and suppresses count: -1 badges", async () => {
    const el = await mount({ expanded: true, selected: ["esp32"] });
    const [first, , third] = rows(el);
    expect(first.getAttribute("aria-checked")).toBe("true");
    expect(first.querySelector(".facet-row-count")?.textContent?.trim()).toBe("3");
    expect(third.querySelector(".facet-row-count")).toBeNull();
  });

  it("filters rows by the search query", async () => {
    const el = await mount({ expanded: true, searchable: true });
    const input = el.shadowRoot!.querySelector<HTMLInputElement>(".facet-search-input")!;
    input.value = "esp";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    expect(rows(el).map((r) => r.textContent?.trim())).toEqual([
      expect.stringContaining("esp32"),
      expect.stringContaining("esp8266"),
    ]);
  });

  it("shows the no-matches state for a fruitless query", async () => {
    const el = await mount({
      expanded: true,
      searchable: true,
      noMatchesLabel: "No matches",
    });
    const input = el.shadowRoot!.querySelector<HTMLInputElement>(".facet-search-input")!;
    input.value = "zzz";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    expect(rows(el)).toHaveLength(0);
    expect(el.shadowRoot!.querySelector(".facet-empty")?.textContent?.trim()).toBe(
      "No matches"
    );
  });

  it("shows the empty state when the dimension has no options", async () => {
    const el = await mount({ expanded: true, options: [], emptyLabel: "No options" });
    expect(el.shadowRoot!.querySelector(".facet-empty")?.textContent?.trim()).toBe(
      "No options"
    );
  });

  it("resets the query when collapsed", async () => {
    const el = await mount({ expanded: true, searchable: true });
    const input = el.shadowRoot!.querySelector<HTMLInputElement>(".facet-search-input")!;
    input.value = "zzz";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;

    el.expanded = false;
    await el.updateComplete;
    el.expanded = true;
    await el.updateComplete;
    expect(rows(el)).toHaveLength(3);
  });
});
