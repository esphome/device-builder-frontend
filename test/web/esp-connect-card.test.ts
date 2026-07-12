// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const openNoPortPickedDialog = vi.fn();
vi.mock("../../src/web/dashboard/esphome-web-no-port-picked-dialog.js", () => ({
  openNoPortPickedDialog: (...a: unknown[]) => openNoPortPickedDialog(...a),
}));
const isPortPickerCancel = vi.fn((..._a: unknown[]) => true);
vi.mock("../../src/util/web-serial.js", () => ({
  isPortPickerCancel: (...a: unknown[]) => isPortPickerCancel(...a),
}));
vi.mock("../../src/web/dashboard/esphome-web-card.js", () => ({}));
vi.mock("../../src/web/dashboard/esphome-web-esp-device-card.js", () => ({}));
vi.mock("../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import toast from "sonner-js";
import { ESPHomeWebEspConnectCard } from "../../src/web/dashboard/esphome-web-esp-connect-card.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  isPortPickerCancel.mockReturnValue(true);
});

describe("esphome-web-esp-connect-card connect cancel", () => {
  it("offers driver help + retry when the picker is cancelled", async () => {
    const el = new ESPHomeWebEspConnectCard();
    (el as any)._localize = (k: string) => k;
    (navigator as any).serial = {
      requestPort: vi.fn(async () => {
        throw new DOMException("cancel", "NotFoundError");
      }),
    };

    await (el as any)._connect();

    expect(openNoPortPickedDialog).toHaveBeenCalledOnce();
    // Second arg is the retry — re-invokes connect.
    expect(typeof openNoPortPickedDialog.mock.calls[0][1]).toBe("function");
    expect(toast.error).not.toHaveBeenCalled();
    expect((el as any)._port).toBeUndefined();
  });

  it("toasts (no driver dialog) on a real connect error", async () => {
    isPortPickerCancel.mockReturnValue(false);
    const el = new ESPHomeWebEspConnectCard();
    (el as any)._localize = (k: string) => k;
    (navigator as any).serial = {
      requestPort: vi.fn(async () => {
        throw new Error("boom");
      }),
    };

    await (el as any)._connect();

    expect(openNoPortPickedDialog).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledOnce();
  });
});
