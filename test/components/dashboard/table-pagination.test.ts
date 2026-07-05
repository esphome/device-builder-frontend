/**
 * @vitest-environment happy-dom
 *
 * The list view's "All" page-size option: it offers value 0, reports 0
 * on change, and hides the page navigation while active (discussion #3682).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeTablePagination } from "../../../src/components/dashboard/table-pagination.js";

async function mount(
  props: Partial<ESPHomeTablePagination> = {}
): Promise<ESPHomeTablePagination> {
  const el = new ESPHomeTablePagination();
  // No context provider in the test tree; map only the new key so the
  // "All" label is meaningful and other keys stay identity.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._localize = (k: string) => (k === "dashboard.pagination_all" ? "All" : k);
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("table-pagination All option", () => {
  it("offers an 'All' option (value 0) in the page-size selector", async () => {
    const el = await mount({ pageSize: 25 });
    const all = [...el.shadowRoot!.querySelectorAll("option")].find(
      (o) => o.value === "0"
    );
    expect(all).toBeTruthy();
    expect(all!.textContent?.trim()).toBe("All");
  });

  it("reports 0 on page-size-change when 'All' is selected", async () => {
    const el = await mount({ pageSize: 25 });
    const onChange = vi.fn();
    el.addEventListener("page-size-change", (e) =>
      onChange((e as CustomEvent<number>).detail)
    );
    const select = el.shadowRoot!.querySelector("select")!;
    select.value = "0";
    select.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("hides the page navigation while 'All' is active", async () => {
    const el = await mount({ pageSize: 0 });
    expect(el.shadowRoot!.querySelector(".buttons")).toBeNull();
    expect(el.shadowRoot!.querySelector(".page-info")).toBeNull();
    // The rows-per-page selector and total-count stay.
    expect(el.shadowRoot!.querySelector("select")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".info")).not.toBeNull();
  });

  it("shows the page navigation for a normal page size", async () => {
    const el = await mount({ pageSize: 25, pageCount: 3, canNextPage: true });
    expect(el.shadowRoot!.querySelector(".buttons")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".page-info")).not.toBeNull();
  });
});

describe("table-pagination accessibility", () => {
  // The visible "Rows per page" <span> is hidden on mobile (and was never
  // programmatically tied to the <select>), so the selector carries its own
  // aria-label to keep an accessible name on every viewport. Guard against a
  // future change dropping it once the label is no longer visible.
  it("gives the page-size selector an accessible name via aria-label", async () => {
    const el = await mount({ pageSize: 25 });
    const select = el.shadowRoot!.querySelector("select")!;
    expect(select.getAttribute("aria-label")).toBe("dashboard.pagination_rows_per_page");
  });
});
