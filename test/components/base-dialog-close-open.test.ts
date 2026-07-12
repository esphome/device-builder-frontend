// @vitest-environment happy-dom
//
// Pins the open-dialog registry behind closeOpenDialogs (issue #1185): open
// wrappers get a request-close (so the host decides, same as Escape), the
// except subtree is shielded across shadow boundaries, busy dialogs are
// absorbed, and closed / disconnected wrappers are ignored.
import { describe, expect, it, vi } from "vitest";

// wa-dialog runs form-validation lifecycle hooks happy-dom doesn't implement;
// stub the import so the wrapper can render in the test.
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));

import { closeOpenDialogs, ESPHomeBaseDialog } from "../../src/components/base-dialog.js";
import { mount } from "../_dom.js";

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
    const closedSpy = watchRequestClose(closedEl);

    closeOpenDialogs();

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(closedSpy).not.toHaveBeenCalled();
  });

  it("leaves the wrapper's own open flag to the host", async () => {
    const el = await mount(new ESPHomeBaseDialog(), { open: true });
    closeOpenDialogs();
    // The host flips this from its request-close handler; the sweep only
    // asks.
    expect(el.open).toBe(true);
  });

  it("absorbs the request while busy", async () => {
    const el = await mount(new ESPHomeBaseDialog(), { open: true, busy: true });
    const spy = watchRequestClose(el);
    closeOpenDialogs();
    expect(spy).not.toHaveBeenCalled();
  });

  it("shields the except subtree across a shadow boundary", async () => {
    const swept = await mount(new ESPHomeBaseDialog(), { open: true });
    const sweptSpy = watchRequestClose(swept);

    // Stands in for a settings-dialog component: the wrapper lives in its
    // shadow DOM, and the component element is what gets passed as except.
    const component = document.createElement("div");
    const shadow = component.attachShadow({ mode: "open" });
    document.body.appendChild(component);
    const shielded = new ESPHomeBaseDialog();
    shielded.open = true;
    shadow.appendChild(shielded);
    await shielded.updateComplete;
    const shieldedSpy = watchRequestClose(shielded);

    closeOpenDialogs(component);

    expect(sweptSpy).toHaveBeenCalledTimes(1);
    expect(shieldedSpy).not.toHaveBeenCalled();
  });

  it("drops a dialog from the sweep once it closes", async () => {
    const el = await mount(new ESPHomeBaseDialog(), { open: true });
    const spy = watchRequestClose(el);
    el.open = false;
    await el.updateComplete;

    closeOpenDialogs();
    expect(spy).not.toHaveBeenCalled();
  });

  it("drops a dialog from the sweep once it disconnects", async () => {
    const el = await mount(new ESPHomeBaseDialog(), { open: true });
    const spy = watchRequestClose(el);
    el.remove();

    closeOpenDialogs();
    expect(spy).not.toHaveBeenCalled();
  });

  it("re-registers an open dialog that reconnects", async () => {
    const el = await mount(new ESPHomeBaseDialog(), { open: true });
    const spy = watchRequestClose(el);
    el.remove();
    document.body.appendChild(el);

    closeOpenDialogs();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
