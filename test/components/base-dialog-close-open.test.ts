// @vitest-environment happy-dom
//
// Pins the open-dialog registry behind closeOpenDialogs (issue #1185): open
// wrappers are closed through the inner wa-dialog's Escape codepath, the
// except subtree is shielded across shadow boundaries, the busy gate absorbs
// the request, and closed / disconnected wrappers are ignored.
import { describe, expect, it, vi } from "vitest";

// wa-dialog runs form-validation lifecycle hooks happy-dom doesn't implement;
// stub the import so the wrapper can render in the test.
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));

import { closeOpenDialogs, ESPHomeBaseDialog } from "../../src/components/base-dialog.js";
import { mount } from "../_dom.js";

/* The real element registration is stubbed out above; register a stand-in
   whose requestClose mimics the real one's entry point — fire the cancelable
   wa-hide and record the outcome — so the wrapper's busy gate and
   request-close re-emission are exercised for real. */
class WaDialogStub extends HTMLElement {
  requestCloseCalls = 0;
  lastHidePrevented: boolean | null = null;

  requestClose(): void {
    this.requestCloseCalls++;
    const ev = new CustomEvent("wa-hide", {
      cancelable: true,
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(ev);
    this.lastHidePrevented = ev.defaultPrevented;
  }
}
customElements.define("wa-dialog", WaDialogStub);

function innerStub(el: ESPHomeBaseDialog): WaDialogStub {
  return el.shadowRoot!.querySelector("wa-dialog") as unknown as WaDialogStub;
}

function watchRequestClose(el: ESPHomeBaseDialog) {
  const spy = vi.fn();
  el.addEventListener("request-close", spy);
  return spy;
}

describe("closeOpenDialogs", () => {
  it("requests close on every open dialog and skips closed ones", async () => {
    const openEl = await mount(new ESPHomeBaseDialog(), { open: true });
    const closedEl = await mount(new ESPHomeBaseDialog(), { open: false });
    const openSpy = watchRequestClose(openEl);

    closeOpenDialogs();

    expect(innerStub(openEl).requestCloseCalls).toBe(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(innerStub(openEl).lastHidePrevented).toBe(false);
    expect(innerStub(closedEl).requestCloseCalls).toBe(0);
  });

  it("leaves the wrapper's own open flag to the host", async () => {
    const el = await mount(new ESPHomeBaseDialog(), { open: true });
    closeOpenDialogs();
    // The host flips this from its request-close/after-hide handlers; the
    // sweep only asks.
    expect(el.open).toBe(true);
  });

  it("absorbs the close while busy, before any host veto", async () => {
    const el = await mount(new ESPHomeBaseDialog(), { open: true, busy: true });
    const spy = watchRequestClose(el);

    closeOpenDialogs();

    expect(innerStub(el).lastHidePrevented).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("shields the except subtree across a shadow boundary", async () => {
    const swept = await mount(new ESPHomeBaseDialog(), { open: true });

    // Stands in for a settings-dialog component: the wrapper lives in its
    // shadow DOM, and the component element is what gets passed as except.
    const component = document.createElement("div");
    const shadow = component.attachShadow({ mode: "open" });
    document.body.appendChild(component);
    const shielded = new ESPHomeBaseDialog();
    shielded.open = true;
    shadow.appendChild(shielded);
    await shielded.updateComplete;

    closeOpenDialogs(component);

    expect(innerStub(swept).requestCloseCalls).toBe(1);
    expect(innerStub(shielded).requestCloseCalls).toBe(0);
  });

  it("drops a dialog from the sweep once it closes", async () => {
    const el = await mount(new ESPHomeBaseDialog(), { open: true });
    el.open = false;
    await el.updateComplete;

    closeOpenDialogs();
    expect(innerStub(el).requestCloseCalls).toBe(0);
  });

  it("drops a dialog from the sweep once it disconnects", async () => {
    const el = await mount(new ESPHomeBaseDialog(), { open: true });
    const stub = innerStub(el);
    el.remove();

    closeOpenDialogs();
    expect(stub.requestCloseCalls).toBe(0);
  });

  it("re-registers an open dialog that reconnects", async () => {
    const el = await mount(new ESPHomeBaseDialog(), { open: true });
    el.remove();
    document.body.appendChild(el);

    closeOpenDialogs();
    expect(innerStub(el).requestCloseCalls).toBe(1);
  });
});
