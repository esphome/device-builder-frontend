/**
 * @vitest-environment happy-dom
 *
 * Pins the USB "Set it up" coordinator: dispatch on the dashboard, stash
 * + navigate off-route, and clear the stash when the leave guard vetoes
 * or throws (so a stale port can't fire on a later mount).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn(async () => {}) }));
vi.mock("../../../src/util/navigation.js", async (importActual) => ({
  ...(await importActual<typeof import("../../../src/util/navigation.js")>()),
  navigate,
}));

import { dispatchOrStashSerialSetup } from "../../../src/components/app-shell/serial-setup.js";
import { consumePendingSerialSetup } from "../../../src/util/pending-serial-setup.js";

const fakePort = {} as SerialPort;

describe("dispatchOrStashSerialSetup", () => {
  beforeEach(() => {
    navigate.mockReset();
    navigate.mockResolvedValue(undefined);
    consumePendingSerialSetup(); // drain any stash leaked by a prior test
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("dispatches the event on the dashboard without stashing or navigating", async () => {
    window.history.replaceState({}, "", "/");
    const onEvent = vi.fn();
    window.addEventListener("esphome-serial-setup", onEvent);
    await dispatchOrStashSerialSetup(fakePort);
    window.removeEventListener("esphome-serial-setup", onEvent);

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect((onEvent.mock.calls[0][0] as CustomEvent).detail.port).toBe(fakePort);
    expect(navigate).not.toHaveBeenCalled();
    expect(consumePendingSerialSetup()).toBeNull();
  });

  it("stashes the port and navigates home from another route", async () => {
    window.history.replaceState({}, "", "/device/foo.yaml");
    navigate.mockImplementation(async () => {
      window.history.replaceState({}, "", "/");
    });
    await dispatchOrStashSerialSetup(fakePort);

    expect(navigate).toHaveBeenCalledWith("/");
    // Navigation landed on the dashboard; the stash survives for it to consume.
    expect(consumePendingSerialSetup()).toEqual({ port: fakePort });
  });

  it("clears the stash when the leave guard vetoes the navigation", async () => {
    window.history.replaceState({}, "", "/device/foo.yaml");
    navigate.mockImplementation(async () => {}); // veto: pathname unchanged
    await dispatchOrStashSerialSetup(fakePort);

    expect(consumePendingSerialSetup()).toBeNull();
  });

  it("clears the stash and never rejects when the leave guard throws", async () => {
    window.history.replaceState({}, "", "/device/foo.yaml");
    navigate.mockImplementation(async () => {
      throw new Error("guard boom");
    });
    await expect(dispatchOrStashSerialSetup(fakePort)).resolves.toBeUndefined();

    expect(consumePendingSerialSetup()).toBeNull();
  });
});
