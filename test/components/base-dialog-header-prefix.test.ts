// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";

// Stub the real wa-dialog (happy-dom can't run its form-associated close
// button); these tests only exercise the wrapper's own header markup.
import { vi } from "vitest";
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));

import { ESPHomeBaseDialog } from "../../src/components/base-dialog.js";

/**
 * Regression coverage for the ``header-prefix`` slot added so the
 * create-config wizard can render a back button to the LEFT of the title
 * (#549). Pins that the slot renders before the title and stays an empty
 * no-op when a consumer doesn't fill it, so a future header refactor can't
 * silently drop it or reorder it past the title.
 */
async function mount(prefix?: string): Promise<ESPHomeBaseDialog> {
  const el = new ESPHomeBaseDialog();
  el.label = "Title";
  if (prefix) el.innerHTML = prefix;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("esphome-base-dialog header-prefix slot", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("renders the prefix slot before the title", async () => {
    const el = await mount();
    const prefix = el.shadowRoot!.querySelector('slot[name="header-prefix"]')!;
    const title = el.shadowRoot!.querySelector('[part="title-text"]')!;
    expect(prefix).toBeTruthy();
    // title must come AFTER the prefix slot in the header.
    expect(
      prefix.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  test("is empty by default (no slotted content)", async () => {
    const el = await mount();
    const prefix = el.shadowRoot!.querySelector(
      'slot[name="header-prefix"]'
    ) as HTMLSlotElement;
    expect(prefix.assignedElements()).toHaveLength(0);
  });

  test("accepts slotted content (e.g. a wizard back button)", async () => {
    const el = await mount('<button slot="header-prefix" class="back">x</button>');
    const prefix = el.shadowRoot!.querySelector(
      'slot[name="header-prefix"]'
    ) as HTMLSlotElement;
    const assigned = prefix.assignedElements();
    expect(assigned).toHaveLength(1);
    expect(assigned[0].classList.contains("back")).toBe(true);
  });
});
