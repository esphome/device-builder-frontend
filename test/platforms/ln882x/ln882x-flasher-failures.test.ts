import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveFakeTimers } from "../../_fake-timers.js";
import {
  Ln882xFlashSizeError,
  Ln882xLinkError,
  Ln882xRamBootError,
  Ln882xStartAddrError,
} from "../../../src/platforms/ln882x/ln882x-flasher.js";
import { Ln882xRamcodeError } from "../../../src/platforms/ln882x/ln882x-ramcode.js";
import { SerialDeviceLostError } from "../../../src/util/serial-open-error.js";
import { RAMCODE } from "./_fake-ln882h.js";
import { commands, flash, image } from "./_ln882x-flash.js";

const ramcode = vi.hoisted(() => ({ fail: null as Error | null }));

vi.mock("../../../src/platforms/ln882x/ln882x-ramcode.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadRamcode: async () => {
    if (ramcode.fail) throw ramcode.fail;
    return RAMCODE;
  },
}));

beforeEach(() => {
  ramcode.fail = null;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("flashLn882x failures", () => {
  it("fails before touching the port when the RAM code cannot be had", async () => {
    ramcode.fail = new Ln882xRamcodeError("firmware.ln_ramcode_unavailable", "offline");
    const { chip, done } = flash();
    await expect(driveFakeTimers(done)).rejects.toBeInstanceOf(Ln882xRamcodeError);
    expect(chip.raw.open).not.toHaveBeenCalled();
  });

  it("leaves the port alone when the dialog closed during the RAM code download", async () => {
    const abort = new AbortController();
    abort.abort();
    const { chip, done } = flash({}, image(), { signal: abort.signal });
    await expect(driveFakeTimers(done)).rejects.toMatchObject({ name: "AbortError" });
    expect(chip.raw.open).not.toHaveBeenCalled();
    expect(chip.signals).toEqual([]);
  });

  it("gives up when nothing answers while the user had the chance", async () => {
    const { chip, log, done } = flash({ start: "firmware" });
    await expect(driveFakeTimers(done)).rejects.toBeInstanceOf(Ln882xLinkError);
    expect(log).toContain("<waiting>");
    expect(log).not.toContain("<linked>");
    expect(chip.raw.close).toHaveBeenCalled();
  });

  it("fails when the RAM code does not start", async () => {
    const { done } = flash({ ramBootFails: true });
    await expect(driveFakeTimers(done)).rejects.toBeInstanceOf(Ln882xRamBootError);
  });

  it("fails on a flash that does not say its size, before anything is written", async () => {
    const { chip, done } = flash({ flashInfo: "\r\nwhat\r\n" });
    await expect(driveFakeTimers(done)).rejects.toBeInstanceOf(Ln882xFlashSizeError);
    expect(commands(chip)).not.toContain("upgrade");
  });

  it("refuses an image that runs past the end of the flash, before anything is written", async () => {
    const { chip, done } = flash(
      {},
      image([{ address: 0x1ff000, data: new Uint8Array(0x2000) }])
    );
    await expect(driveFakeTimers(done)).rejects.toThrow(/past the end of the flash/);
    expect(commands(chip)).not.toContain("upgrade");
  });

  it("fails on a start address the chip refuses", async () => {
    const { done } = flash({ startaddrFails: true });
    await expect(driveFakeTimers(done)).rejects.toBeInstanceOf(Ln882xStartAddrError);
  });

  it("fails when the chip stops answering after a transfer", async () => {
    const { done } = flash({ deafAfterUpgrades: 1 });
    await expect(driveFakeTimers(done)).rejects.toThrow(
      "The chip stopped answering after the transfer"
    );
  });

  it("stops on abort while it waits for the user, and releases the port", async () => {
    const abort = new AbortController();
    const { chip, done } = flash({ start: "firmware" }, image(), {
      signal: abort.signal,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    abort.abort();
    await expect(driveFakeTimers(done)).rejects.toMatchObject({ name: "AbortError" });
    expect(chip.raw.close).toHaveBeenCalled();
    // BOOT is not left held.
    expect(chip.signals[chip.signals.length - 1]).toEqual({
      dataTerminalReady: false,
      requestToSend: false,
    });
  });

  it("fails when the port goes away mid-transfer", async () => {
    const { chip, done } = flash();
    await vi.advanceTimersByTimeAsync(0);
    chip.dropLink();
    await expect(driveFakeTimers(done)).rejects.toThrow(SerialDeviceLostError);
  });
});
