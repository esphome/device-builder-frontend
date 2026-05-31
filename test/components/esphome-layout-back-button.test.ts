// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";

import { ESPHomeLayout } from "../../src/components/esphome-layout.js";

interface LayoutPrivateView {
  _path: string;
  readonly _showBack: boolean;
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
