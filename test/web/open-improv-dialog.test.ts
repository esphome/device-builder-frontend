// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

// The SDK module only needs to register the custom element as a side effect;
// in happy-dom ``createElement`` yields a generic element we drive directly.
vi.mock("improv-wifi-serial-sdk/dist/serial-provision-dialog", () => ({}));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));

import toast from "sonner-js";
import { openImprovDialog } from "../../src/web/improv/open-improv-dialog.js";

const localize: (k: string, v?: Record<string, string | number>) => string = (k) => k;
const flush = () => new Promise((r) => setTimeout(r, 0));

function makePort(openImpl?: () => Promise<void>): {
  open: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  readable: unknown;
  writable: unknown;
} {
  return {
    open: vi.fn(openImpl ?? (async () => {})),
    close: vi.fn(async () => {}),
    readable: null,
    writable: null,
  };
}

function dialogEls(): NodeListOf<HTMLElement> {
  return document.querySelectorAll("improv-wifi-serial-provision-dialog");
}
function dialogEl(): HTMLElement | null {
  return document.querySelector("improv-wifi-serial-provision-dialog");
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("openImprovDialog", () => {
  it("opens the port at 115200 with an 8k buffer and mounts the SDK dialog", async () => {
    const port = makePort();
    const promise = openImprovDialog(port as unknown as SerialPort, localize);
    await flush();

    expect(port.open).toHaveBeenCalledWith({ baudRate: 115200, bufferSize: 8192 });
    const el = dialogEl();
    expect(el).toBeTruthy();
    expect((el as unknown as { port: unknown }).port).toBe(port);

    el!.dispatchEvent(
      new CustomEvent("closed", { detail: { improv: true, provisioned: true } })
    );
    await expect(promise).resolves.toEqual({ improv: true, provisioned: true });
  });

  it("reports improv-detected-but-not-provisioned and closes the port", async () => {
    const port = makePort();
    const promise = openImprovDialog(port as unknown as SerialPort, localize);
    await flush();

    dialogEl()!.dispatchEvent(
      new CustomEvent("closed", { detail: { improv: true, provisioned: false } })
    );
    await expect(promise).resolves.toEqual({ improv: true, provisioned: false });
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("coerces a missing detail to a false/false result", async () => {
    const port = makePort();
    const promise = openImprovDialog(port as unknown as SerialPort, localize);
    await flush();

    dialogEl()!.dispatchEvent(new CustomEvent("closed", { detail: {} }));
    await expect(promise).resolves.toEqual({ improv: false, provisioned: false });
  });

  it("does NOT remove the dialog itself (the SDK owns removal)", async () => {
    const port = makePort();
    const promise = openImprovDialog(port as unknown as SerialPort, localize);
    await flush();

    dialogEl()!.dispatchEvent(new CustomEvent("closed", { detail: {} }));
    await promise;
    // Wrapper left the element in place; the real SDK's _handleClose removes it
    // after firing "closed" — a second removal here would crash removeChild.
    expect(dialogEl()).toBeTruthy();
  });

  it("proceeds when the port is already open, and does NOT close a port it didn't open", async () => {
    const port = makePort(async () => {
      throw new DOMException("already open", "InvalidStateError");
    });
    const promise = openImprovDialog(port as unknown as SerialPort, localize);
    await flush();

    expect(dialogEl()).toBeTruthy();
    dialogEl()!.dispatchEvent(
      new CustomEvent("closed", { detail: { improv: true, provisioned: false } })
    );
    await promise;
    // We didn't open it, so we must not close it.
    expect(port.close).not.toHaveBeenCalled();
  });

  it("ignores a second call on the same port while one is in flight", async () => {
    const port = makePort();
    const first = openImprovDialog(port as unknown as SerialPort, localize);
    const second = await openImprovDialog(port as unknown as SerialPort, localize);
    await flush();

    // The guard bailed the second call without mounting a second dialog.
    expect(second).toEqual({ improv: false, provisioned: false });
    expect(dialogEls().length).toBe(1);

    dialogEl()!.dispatchEvent(new CustomEvent("closed", { detail: {} }));
    await first;

    // The real SDK removes its dialog on close; our mock doesn't, so clear the
    // leftover element before checking that the port is free for a new session.
    dialogEls().forEach((el) => el.remove());
    const third = openImprovDialog(port as unknown as SerialPort, localize);
    await flush();
    expect(dialogEls().length).toBe(1);
    dialogEl()!.dispatchEvent(new CustomEvent("closed", { detail: {} }));
    await third;
  });

  it("bails with a toast when the already-open port's streams are locked", async () => {
    const port = makePort(async () => {
      throw new DOMException("already open", "InvalidStateError");
    });
    port.readable = { locked: true };
    const result = await openImprovDialog(port as unknown as SerialPort, localize);

    expect(result).toEqual({ improv: false, provisioned: false });
    expect(toast.error).toHaveBeenCalledOnce();
    expect(dialogEl()).toBeNull();
  });

  it("toasts and returns a false result without mounting when open fails", async () => {
    const port = makePort(async () => {
      throw new Error("device gone");
    });
    const result = await openImprovDialog(port as unknown as SerialPort, localize);

    expect(result).toEqual({ improv: false, provisioned: false });
    expect(toast.error).toHaveBeenCalledOnce();
    expect(dialogEl()).toBeNull();
  });
});
