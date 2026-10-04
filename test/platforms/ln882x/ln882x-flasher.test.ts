import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveFakeTimers } from "../../_fake-timers.js";
import { RAMCODE } from "./_fake-ln882h.js";
import { commands, expectImage, flash, image } from "./_ln882x-flash.js";

vi.mock("../../../src/platforms/ln882x/ln882x-ramcode.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadRamcode: async () => RAMCODE,
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("flashLn882x", () => {
  it("links to a chip strapped by hand, loads the RAM code, writes every run and reboots", async () => {
    const { chip, log, progress, done } = flash();
    expect(await driveFakeTimers(done)).toBe(true);
    expect(log).toEqual([
      "Looking for the chip's downloader",
      "<linked>",
      "Loading the RAM code (1000 bytes)",
      "Linked to the RAM code (flash EB6015, 2 MiB); 2 runs to write",
      "Writing 0x0 (434 bytes)",
      "Writing 0x0: 29%",
      "Writing 0x0: 58%",
      "Writing 0x0: 88%",
      "Writing 0x0: 100%",
      "Wrote 0x0",
      "Writing 0x7000 (300 bytes)",
      "Writing 0x7000: 42%",
      "Writing 0x7000: 85%",
      "Writing 0x7000: 100%",
      "Wrote 0x7000",
      "Rebooting into the firmware",
    ]);
    expect(commands(chip)).toEqual([
      "version",
      "download [rambin] [0x20000000] [1000]",
      "version",
      "flash_info",
      "startaddr 0x0",
      "upgrade",
      "version",
      "startaddr 0x7000",
      "upgrade",
      "version",
      "reboot",
    ]);
    expect(chip.raw.open).toHaveBeenCalledWith({ baudRate: 115200 });
    expect(chip.ram()).toEqual(RAMCODE);
    expectImage(chip);
    expect(chip.rebooted()).toBe(true);
    expect(progress[progress.length - 1]).toBe(100);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(chip.raw.close).toHaveBeenCalled();
  });

  it("resets a dev board into download mode over DTR/RTS, holding BOOT until the RAM code runs", async () => {
    const { chip, log, done } = flash({ start: "firmware", wired: true });
    expect(await driveFakeTimers(done)).toBe(true);
    expect(log).toContain(
      "No answer; resetting the chip into download mode over DTR/RTS"
    );
    expect(log).not.toContain("<waiting>");
    expect(chip.signals).toEqual([
      // Chromium's lines released on open, so a CEN on RTS is not held in reset.
      { dataTerminalReady: false, requestToSend: false },
      // CEN low with BOOT released, then CEN released with BOOT held low.
      { dataTerminalReady: false, requestToSend: true },
      { dataTerminalReady: true, requestToSend: false },
      // BOOT let go once the RAM code answers.
      { dataTerminalReady: false },
      { dataTerminalReady: false, requestToSend: false },
    ]);
    expectImage(chip);
  });

  it("tries the reset again when the first pulse does not reach the chip", async () => {
    const { chip, log, done } = flash({ start: "firmware", wired: true, lostResets: 2 });
    expect(await driveFakeTimers(done)).toBe(true);
    expect(log).toContain("No answer; resetting again (attempt 2 of 3)");
    expectImage(chip);
  });

  it("falls back to the BOOT guide and keeps polling until the chip answers", async () => {
    const { chip, log, done } = flash({ start: "firmware", strapAfterPings: 40 });
    expect(await driveFakeTimers(done)).toBe(true);
    expect(log).toContain("No answer; resetting again (attempt 3 of 3)");
    expect(log).toContain(
      "No answer; waiting for download mode (BOOT, GPIOA9, to GND, then reset)"
    );
    expect(log.indexOf("<waiting>")).toBeLessThan(log.indexOf("<linked>"));
    expectImage(chip);
  });

  it("goes straight to the guide on an adapter without control lines", async () => {
    const { chip, log, done } = flash({
      start: "firmware",
      noSignals: true,
      strapAfterPings: 5,
    });
    expect(await driveFakeTimers(done)).toBe(true);
    expect(log).not.toContain("No answer; resetting again (attempt 2 of 3)");
    expect(log).toContain("<waiting>");
    expectImage(chip);
  });

  it("uses a RAM code already running from an earlier attempt", async () => {
    const { chip, log, done } = flash({ start: "ramcode" });
    expect(await driveFakeTimers(done)).toBe(true);
    expect(log).toContain("The RAM code is already running");
    expect(commands(chip)).not.toContain("download [rambin] [0x20000000] [1000]");
    expectImage(chip);
  });

  it("sends a block the chip did not take again", async () => {
    const { chip, done } = flash({ nakFirstBlock: true });
    expect(await driveFakeTimers(done)).toBe(true);
    expect(chip.ram()).toEqual(RAMCODE);
    expectImage(chip);
  });

  it("resets the board over the lines when the chip does not confirm the reboot", async () => {
    const { chip, log, done } = flash({ silentReboot: true, wired: true });
    expect(await driveFakeTimers(done)).toBe(true);
    expect(log[log.length - 1]).toBe("Rebooting into the firmware");
    expect(chip.signals.slice(-3)).toEqual([
      { dataTerminalReady: false, requestToSend: true },
      { dataTerminalReady: false, requestToSend: false },
      { dataTerminalReady: false, requestToSend: false },
    ]);
  });

  it("does not take a reset its lines never reached for a reboot", async () => {
    // An adapter wired to TX, RX and GND alone accepts the line changes; the
    // RAM code still answering says the chip never reset.
    const { chip, log, done } = flash({ silentReboot: true });
    expect(await driveFakeTimers(done)).toBe(false);
    expect(chip.signals).toContainEqual({
      dataTerminalReady: false,
      requestToSend: true,
    });
    expect(log[log.length - 1]).toBe(
      "The chip did not confirm the reboot; release BOOT and reset it by hand"
    );
  });

  it("says the chip needs a reset by hand when nothing confirmed the reboot", async () => {
    const { log, done } = flash({ silentReboot: true, noSignals: true });
    expect(await driveFakeTimers(done)).toBe(false);
    expect(log[log.length - 1]).toBe(
      "The chip did not confirm the reboot; release BOOT and reset it by hand"
    );
  });

  it("sends runs that follow on from one another as one transfer, as ltchiptool does", async () => {
    // A build's bootloader, partition table and app: the RAM code carries one
    // transfer's tail into the next, so they must not go separately.
    const bytes = (length: number, fill: number) => new Uint8Array(length).fill(fill);
    const runs = [
      { address: 0x0, data: bytes(0x6000, 0x11) },
      { address: 0x6000, data: bytes(0x1000, 0x22) },
      { address: 0x7000, data: bytes(300, 0x33) },
    ];
    const { chip, log, done } = flash({}, image(runs));
    expect(await driveFakeTimers(done)).toBe(true);
    expect(commands(chip).filter((c) => c.startsWith("startaddr"))).toEqual([
      "startaddr 0x0",
    ]);
    expect(log).toContain("Writing 0x0 (28972 bytes)");
    expectImage(chip, image(runs));
  });

  it("gives up on line changes that never settle instead of hanging", async () => {
    // A chip strapped by hand behind an adapter whose line changes stay pending.
    const { chip, done } = flash({ hangSignals: true });
    expect(await driveFakeTimers(done)).toBe(true);
    expectImage(chip);
    expect(chip.raw.close).toHaveBeenCalled();
  });

  it("opens the port only when it is not open yet", async () => {
    const { chip, done } = flash();
    await chip.port.open({ baudRate: 115200 });
    chip.raw.open.mockClear();
    await driveFakeTimers(done);
    expect(chip.raw.open).not.toHaveBeenCalled();
    expectImage(chip, image());
  });
});
