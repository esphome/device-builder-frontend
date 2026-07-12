// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

// A factory that throws makes the lazy `await import(...)` reject, simulating a
// chunk-load / CSP / network failure of the Improv SDK bundle.
vi.mock("improv-wifi-serial-sdk/dist/serial-provision-dialog", () => {
  throw new Error("chunk load failed");
});
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));

import toast from "sonner-js";
import { openImprovDialog } from "../../src/web/improv/open-improv-dialog.js";

describe("openImprovDialog — SDK load failure", () => {
  it("closes the port and returns false with a toast when the chunk fails to load", async () => {
    const close = vi.fn(async () => {});
    const port = {
      open: vi.fn(async () => {}),
      close,
      readable: null,
      writable: null,
    };

    const result = await openImprovDialog(port as unknown as SerialPort, (k) => k);

    expect(result).toEqual({ improv: false, provisioned: false });
    expect(close).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledOnce();
    expect(document.querySelector("improv-wifi-serial-provision-dialog")).toBeNull();
  });
});
