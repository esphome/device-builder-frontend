/**
 * @vitest-environment happy-dom
 *
 * The add-component dialog submits the form view on a plain Enter via the
 * base-dialog's confirmOnEnter (issue esphome/device-builder#2400): armed
 * only while the form view is showing, routed through the form's
 * requestSubmit(), and inert in the catalog view (no selection for Enter
 * to act on) and while closed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../_mock-webawesome.js";

// Stub the catalog with the two methods open()/openWithSearch() call on it.
vi.mock("../../../src/components/device/component-catalog.js", () => {
  class StubCatalog extends HTMLElement {
    load(): void {}
    filterByDomain(): void {}
  }
  if (!customElements.get("esphome-component-catalog")) {
    customElements.define("esphome-component-catalog", StubCatalog);
  }
  return {};
});

// Stub the form so the dialog's _form query resolves to an element whose
// requestSubmit() calls we can count; the real form's guard has its own test
// (add-component-form-request-submit.test.ts).
const requestSubmitCalls: HTMLElement[] = [];
vi.mock("../../../src/components/device/add-component-form.js", () => {
  class StubForm extends HTMLElement {
    requestSubmit(): void {
      requestSubmitCalls.push(this);
    }
  }
  if (!customElements.get("esphome-add-component-form")) {
    customElements.define("esphome-add-component-form", StubForm);
  }
  return {};
});

import { ESPHomeAddComponentDialog } from "../../../src/components/device/add-component-dialog.js";
import { mount } from "../../_dom.js";
import { pressEnter } from "../../_press-enter.js";

beforeEach(() => {
  requestSubmitCalls.length = 0;
});

async function enterFormView(el: ESPHomeAddComponentDialog): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._selected = { name: "Restart Button", category: "button" };
  await el.updateComplete;
}

describe("add-component-dialog Enter-to-submit (#2400)", () => {
  it("Enter in the form view submits through the form", async () => {
    const el = await mount(new ESPHomeAddComponentDialog());
    el.open();
    await enterFormView(el);
    pressEnter();
    expect(requestSubmitCalls).toHaveLength(1);
  });

  it("Enter in the catalog view does nothing", async () => {
    const el = await mount(new ESPHomeAddComponentDialog());
    el.open();
    await el.updateComplete;
    pressEnter();
    expect(requestSubmitCalls).toHaveLength(0);
  });

  it("Enter while closed does nothing", async () => {
    const el = await mount(new ESPHomeAddComponentDialog());
    await enterFormView(el);
    pressEnter();
    expect(requestSubmitCalls).toHaveLength(0);
  });

  it("drops a key-repeat Enter while a submit is in flight", async () => {
    const el = await mount(new ESPHomeAddComponentDialog());
    el.open();
    await enterFormView(el);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._submitting = true;
    pressEnter({ repeat: true });
    expect(requestSubmitCalls).toHaveLength(0);
  });

  it("stops firing after leaving the form view via back", async () => {
    const el = await mount(new ESPHomeAddComponentDialog());
    el.open();
    await enterFormView(el);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._selected = null;
    await el.updateComplete;
    pressEnter();
    expect(requestSubmitCalls).toHaveLength(0);
  });
});
