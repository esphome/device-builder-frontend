// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));

import {
  ESPHomeWebNoPortPickedDialog,
  openNoPortPickedDialog,
} from "../../src/web/dashboard/esphome-web-no-port-picked-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

function dialogEl(): ESPHomeWebNoPortPickedDialog | null {
  return document.querySelector("esphome-web-no-port-picked-dialog");
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("openNoPortPickedDialog", () => {
  it("mounts open, shows the driver links, and retries via the callback", async () => {
    const onTryAgain = vi.fn();
    openNoPortPickedDialog((k) => k, onTryAgain);

    const el = dialogEl()!;
    expect(el).toBeTruthy();
    expect(el.open).toBe(true);
    await el.updateComplete;

    // CP2102 (1) + CH34x (2) + CH340 (2) = 5 driver links.
    expect(el.shadowRoot!.querySelectorAll("a[href]").length).toBe(5);

    (el as any)._tryAgain();
    expect(onTryAgain).toHaveBeenCalledOnce();
    expect(el.open).toBe(false);
  });

  it("removes itself from the DOM after it hides", () => {
    openNoPortPickedDialog((k) => k);
    const el = dialogEl()!;
    el.dispatchEvent(new CustomEvent("after-hide"));
    expect(dialogEl()).toBeNull();
  });

  it("works without a retry callback (plain close)", async () => {
    openNoPortPickedDialog((k) => k);
    const el = dialogEl()!;
    await el.updateComplete;
    expect(el.onTryAgain).toBeUndefined();
    expect(el.shadowRoot!.querySelectorAll("a[href]").length).toBe(5);
  });
});
