// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";

import { ESPHomeLayout } from "../../src/components/esphome-layout.js";
import { setLeaveGuard } from "../../src/util/navigation.js";

interface LayoutPrivateView {
  _path: string;
  readonly _showBack: boolean;
  _goHome: () => Promise<void>;
}

function makeLayout(path: string): LayoutPrivateView {
  const layout = new ESPHomeLayout() as unknown as LayoutPrivateView;
  layout._path = path;
  return layout;
}

describe("esphome-layout header back button visibility", () => {
  test("hidden on the device-list root", () => {
    expect(makeLayout("/")._showBack).toBe(false);
    expect(makeLayout("")._showBack).toBe(false);
  });

  test("shown inside a device editor and other non-root routes", () => {
    expect(makeLayout("/device/living-room")._showBack).toBe(true);
    expect(makeLayout("/secrets")._showBack).toBe(true);
  });
});

// The header back arrow pops history via history.back(), whose raw popstate the
// router commits before the device editor's popstate guard can veto it. _goHome
// therefore runs the active leave guard up front (like navigate() does) and
// only pops when it resolves "proceed". Pin that gate so a dirty editor can't
// be navigated away from without the prompt.
describe("esphome-layout back arrow leave guard", () => {
  afterEach(() => {
    setLeaveGuard(null);
    vi.restoreAllMocks();
  });

  test("pops history when no guard vetoes", async () => {
    // history.state is an object (set by pushState) → the history.back() branch.
    window.history.pushState({}, "", "/device/x");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    await makeLayout("/device/x")._goHome();
    expect(back).toHaveBeenCalledTimes(1);
  });

  test("does NOT pop history when the leave guard resolves false", async () => {
    window.history.pushState({}, "", "/device/x");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const guard = vi.fn(() => Promise.resolve(false));
    setLeaveGuard(guard);
    await makeLayout("/device/x")._goHome();
    expect(guard).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });

  test("pops history when the leave guard resolves true", async () => {
    window.history.pushState({}, "", "/device/x");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const guard = vi.fn(() => Promise.resolve(true));
    setLeaveGuard(guard);
    await makeLayout("/device/x")._goHome();
    expect(guard).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
  });
});
