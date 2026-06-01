/**
 * @vitest-environment happy-dom
 *
 * Pins the mobile "Filters" menu shell: the active-count badge, the
 * open/close lifecycle (trigger click, Escape, outside-click) and the
 * "Clear all" footer that surfaces a bubbling ``clear-filters`` event
 * for the dashboard to wipe every filter. The facet pills it hosts
 * are slotted in by the page and tested elsewhere.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeFiltersMenu } from "../../../src/components/dashboard/filters-menu.js";

async function mount(activeCount = 0): Promise<ESPHomeFiltersMenu> {
  const el = new ESPHomeFiltersMenu();
  el.activeCount = activeCount;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function pressEscape(): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
      composed: true,
    })
  );
}

const trigger = (el: ESPHomeFiltersMenu) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(".facet-trigger")!;
const popover = (el: ESPHomeFiltersMenu) =>
  el.shadowRoot!.querySelector(".filters-popover");
const badge = (el: ESPHomeFiltersMenu) => el.shadowRoot!.querySelector(".filters-badge");

describe("esphome-filters-menu", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("hides the badge when no facets are active", async () => {
    const el = await mount(0);
    expect(badge(el)).toBeNull();
  });

  it("shows the active count in the badge", async () => {
    const el = await mount(3);
    expect(badge(el)?.textContent?.trim()).toBe("3");
    // Bare number is decorative; the trigger carries the meaning.
    expect(badge(el)?.getAttribute("aria-hidden")).toBe("true");
  });

  it("uses the count label as the trigger's accessible name when active", async () => {
    const el = await mount(2);
    el.countLabel = "2 active filters";
    await el.updateComplete;
    expect(trigger(el).getAttribute("aria-label")).toBe("2 active filters");
  });

  it("falls back to the button label when no filters are active", async () => {
    const el = await mount(0);
    expect(trigger(el).getAttribute("aria-label")).toBe("Filters");
  });

  it("opens the popover on trigger click and closes on a second click", async () => {
    const el = await mount(2);
    expect(popover(el)).toBeNull();

    trigger(el).click();
    await el.updateComplete;
    expect(popover(el)).not.toBeNull();
    // Slotted facet pills land in the popover.
    expect(el.shadowRoot!.querySelector("slot")).not.toBeNull();

    trigger(el).click();
    await el.updateComplete;
    expect(popover(el)).toBeNull();
  });

  // Anchor side is decided from the trigger's viewport position so the
  // popover never spills off-screen: open leftward only when a default
  // rightward open would overflow the right edge.
  async function openAt(triggerLeft: number, innerWidth: number) {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      value: innerWidth,
      configurable: true,
    });
    const el = await mount(1);
    trigger(el).getBoundingClientRect = () =>
      ({ left: triggerLeft, top: 0, right: triggerLeft, bottom: 0 }) as DOMRect;
    trigger(el).click();
    await el.updateComplete;
    Object.defineProperty(window, "innerWidth", {
      value: original,
      configurable: true,
    });
    return el;
  }

  it("anchors right when the trigger sits at the end of a wide toolbar", async () => {
    const el = await openAt(900, 1000);
    expect(popover(el)!.classList.contains("anchor-right")).toBe(true);
  });

  it("anchors left when the trigger has wrapped to the left on a phone", async () => {
    const el = await openAt(16, 760);
    expect(popover(el)!.classList.contains("anchor-right")).toBe(false);
  });

  it("renders Clear all only while filters are active and emits clear-filters", async () => {
    const el = await mount(2);
    trigger(el).click();
    await el.updateComplete;

    const onClear = vi.fn();
    el.addEventListener("clear-filters", onClear);
    const clearBtn =
      el.shadowRoot!.querySelector<HTMLButtonElement>(".facet-clear-link")!;
    expect(clearBtn).not.toBeNull();

    clearBtn.click();
    await el.updateComplete;
    expect(onClear).toHaveBeenCalledTimes(1);
    // Clearing closes the menu.
    expect(popover(el)).toBeNull();
  });

  it("omits Clear all when nothing is active", async () => {
    const el = await mount(0);
    trigger(el).click();
    await el.updateComplete;
    expect(popover(el)).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".facet-clear-link")).toBeNull();
  });

  it("closes on Escape", async () => {
    const el = await mount(1);
    trigger(el).click();
    await el.updateComplete;
    expect(popover(el)).not.toBeNull();

    pressEscape();
    await el.updateComplete;
    expect(popover(el)).toBeNull();
  });

  it("closes on a click outside the menu", async () => {
    const el = await mount(1);
    trigger(el).click();
    await el.updateComplete;
    expect(popover(el)).not.toBeNull();

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.click();
    await el.updateComplete;
    expect(popover(el)).toBeNull();
  });
});
