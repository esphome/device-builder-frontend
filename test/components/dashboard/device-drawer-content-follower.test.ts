/**
 * @vitest-environment happy-dom
 *
 * Pins the drawer host's follower wiring — the closures the controller
 * unit tests cannot see: onTeardown is the only path clearing the
 * snapshot, a device swap retargets the stream, and detach tears down
 * through hostDisconnected.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../../src/components/labels/device-labels-editor.js", () => ({}));

import { flush } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { makeReachabilityEvent } from "../../_make-reachability-event.js";
import { mountDrawerContent as mountDrawer } from "./_drawer-content.js";

describe("drawer follower wiring", () => {
  it("closing the drawer clears the snapshot and unsubscribes", async () => {
    const { el, api, unsubscribe } = await mountDrawer();
    const sub = api.subscribeDeviceReachability as ReturnType<typeof vi.fn>;
    expect(sub).toHaveBeenCalledWith("kitchen", expect.any(Function));
    const callback = sub.mock.calls[0][1];
    callback(makeReachabilityEvent());
    expect(el._reachability).not.toBeNull();
    expect(el._reachabilityAnchorMs).toBeGreaterThan(0);

    el.drawerOpen = false;
    await el.updateComplete;
    // onTeardown is the only remaining path that blanks these.
    expect(el._reachability).toBeNull();
    expect(el._reachabilityAnchorMs).toBe(0);
    expect(unsubscribe).toHaveBeenCalledOnce();
    el.remove();
  });

  it("a device swap retargets the stream at the new name", async () => {
    const { el, api, unsubscribe } = await mountDrawer();
    el.device = makeConfiguredDevice({
      name: "garage",
      configuration: "garage.yaml",
    });
    await el.updateComplete;
    await flush();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(api.subscribeDeviceReachability).toHaveBeenLastCalledWith(
      "garage",
      expect.any(Function)
    );
    el.remove();
  });

  it("detaching the element tears the stream down", async () => {
    const { el, unsubscribe } = await mountDrawer();
    el.remove();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
