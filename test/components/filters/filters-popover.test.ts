/**
 * @vitest-environment happy-dom
 *
 * Pins the popover shell: badge, open/close lifecycle (trigger,
 * Escape with focus handback, outside-click, request-popover-close),
 * the header Clear all, and exclusive-open accordion coordination.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeFiltersPopover } from "../../../src/components/filters/filters-popover.js";

class FakeSection extends HTMLElement {
  expanded = false;
}
customElements.define("fake-filter-section", FakeSection);

async function mount(
  activeCount = 0,
  sectionCount = 0
): Promise<{ el: ESPHomeFiltersPopover; sections: FakeSection[] }> {
  const el = new ESPHomeFiltersPopover();
  el.activeCount = activeCount;
  const sections: FakeSection[] = [];
  for (let i = 0; i < sectionCount; i++) {
    const s = new FakeSection();
    el.appendChild(s);
    sections.push(s);
  }
  document.body.appendChild(el);
  await el.updateComplete;
  return { el, sections };
}

function pressEscape(target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  target.dispatchEvent(event);
  return event;
}

const trigger = (el: ESPHomeFiltersPopover) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(".facet-trigger")!;
const popover = (el: ESPHomeFiltersPopover) =>
  el.shadowRoot!.querySelector(".filters-popover");
const badge = (el: ESPHomeFiltersPopover) =>
  el.shadowRoot!.querySelector(".filters-badge");

describe("esphome-filters-popover", () => {
  it("hides the badge when no facets are active", async () => {
    const { el } = await mount(0);
    expect(badge(el)).toBeNull();
  });

  it("shows the active count in the badge", async () => {
    const { el } = await mount(3);
    expect(badge(el)?.textContent?.trim()).toBe("3");
    // Bare number is decorative; the trigger carries the meaning.
    expect(badge(el)?.getAttribute("aria-hidden")).toBe("true");
  });

  it("uses the count label as the trigger's accessible name when active", async () => {
    const { el } = await mount(2);
    el.countLabel = "2 active filters";
    await el.updateComplete;
    expect(trigger(el).getAttribute("aria-label")).toBe("2 active filters");
  });

  it("falls back to the button label when no filters are active", async () => {
    const { el } = await mount(0);
    expect(trigger(el).getAttribute("aria-label")).toBe("Filters");
  });

  it("opens the popover on trigger click and closes on a second click", async () => {
    const { el } = await mount(2);
    expect(popover(el)).toBeNull();

    trigger(el).click();
    await el.updateComplete;
    expect(popover(el)).not.toBeNull();
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
    const { el } = await mount(1);
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
    const { el } = await mount(2);
    trigger(el).click();
    await el.updateComplete;

    const onClear = vi.fn();
    el.addEventListener("clear-filters", onClear);
    const clearBtn =
      el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-clear-link")!;
    expect(clearBtn).not.toBeNull();

    clearBtn.click();
    await el.updateComplete;
    expect(onClear).toHaveBeenCalledTimes(1);
    // Clearing closes the popover.
    expect(popover(el)).toBeNull();
  });

  it("omits Clear all when nothing is active", async () => {
    const { el } = await mount(0);
    trigger(el).click();
    await el.updateComplete;
    expect(popover(el)).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".filters-clear-link")).toBeNull();
  });

  it("closes on Escape, consumes the event, and refocuses the trigger", async () => {
    const { el } = await mount(1);
    trigger(el).click();
    await el.updateComplete;
    expect(popover(el)).not.toBeNull();

    const focus = vi.spyOn(trigger(el), "focus");
    const event = pressEscape();
    await el.updateComplete;
    expect(popover(el)).toBeNull();
    expect(event.defaultPrevented).toBe(true);
    expect(focus).toHaveBeenCalled();
  });

  it("ignores an Escape another overlay already consumed", async () => {
    const { el } = await mount(1);
    trigger(el).click();
    await el.updateComplete;

    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    event.preventDefault();
    window.dispatchEvent(event);
    await el.updateComplete;
    expect(popover(el)).not.toBeNull();
  });

  it("closes on a click outside the popover", async () => {
    const { el } = await mount(1);
    trigger(el).click();
    await el.updateComplete;
    expect(popover(el)).not.toBeNull();

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.click();
    await el.updateComplete;
    expect(popover(el)).toBeNull();
  });

  it("closes when a section requests it", async () => {
    const { el, sections } = await mount(1, 1);
    trigger(el).click();
    await el.updateComplete;
    expect(popover(el)).not.toBeNull();

    sections[0].dispatchEvent(
      new CustomEvent("request-popover-close", { bubbles: true, composed: true })
    );
    await el.updateComplete;
    expect(popover(el)).toBeNull();
  });

  it("opens one section at a time and toggles the dispatcher", async () => {
    const { el, sections } = await mount(0, 3);
    trigger(el).click();
    await el.updateComplete;

    const toggle = (s: FakeSection) =>
      s.dispatchEvent(
        new CustomEvent("filter-section-toggle", { bubbles: true, composed: true })
      );

    toggle(sections[0]);
    expect(sections.map((s) => s.expanded)).toEqual([true, false, false]);

    // Opening another section collapses the first.
    toggle(sections[2]);
    expect(sections.map((s) => s.expanded)).toEqual([false, false, true]);

    // Toggling the open section collapses it.
    toggle(sections[2]);
    expect(sections.map((s) => s.expanded)).toEqual([false, false, false]);
  });

  it("collapses every section on close so the next open starts fresh", async () => {
    const { el, sections } = await mount(0, 2);
    trigger(el).click();
    await el.updateComplete;
    sections[1].dispatchEvent(
      new CustomEvent("filter-section-toggle", { bubbles: true, composed: true })
    );
    expect(sections[1].expanded).toBe(true);

    trigger(el).click();
    await el.updateComplete;
    expect(sections.map((s) => s.expanded)).toEqual([false, false]);
  });
});
