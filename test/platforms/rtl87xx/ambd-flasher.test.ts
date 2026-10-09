import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveFakeTimers } from "../../_fake-timers.js";

const mocks = vi.hoisted(() => ({ loadAmbdLoader: vi.fn<() => Promise<Uint8Array>>() }));
// The loader itself is fetched (ambd-loader.test.ts); here it is a stand-in blob.
vi.mock("../../../src/platforms/rtl87xx/ambd-loader.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadAmbdLoader: mocks.loadAmbdLoader,
}));

import {
  AmbdLinkError,
  AmbdLoaderError,
  AmbdVerifyError,
  flashAmbd,
} from "../../../src/platforms/rtl87xx/ambd-flasher.js";
import { parseAmbdImage } from "../../../src/platforms/rtl87xx/ambd-image.js";
import { checksum32 } from "../../../src/platforms/rtl87xx/ambd-link.js";
import { SerialDeviceLostError } from "../../../src/util/serial-open-error.js";
import {
  fakeAmbd,
  type FakeAmbdOptions,
  IMAGE_SIGNATURE,
  makeAmbdUf2,
  OTA1_OFFSET,
  OTA2_OFFSET,
} from "./_fake-ambd.js";

const IMAGE = parseAmbdImage(makeAmbdUf2());
/** A stand-in loader: the engine only needs its bytes. */
const LOADER = Uint8Array.from({ length: 4688 }, (_, i) => (i * 3 + 1) % 255);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  mocks.loadAmbdLoader.mockReset();
  mocks.loadAmbdLoader.mockResolvedValue(LOADER);
});
afterEach(() => {
  vi.useRealTimers();
});

function flash(
  opts: FakeAmbdOptions = {},
  hooks: Partial<Parameters<typeof flashAmbd>[2]> = {}
) {
  const chip = fakeAmbd(opts);
  const log: string[] = [];
  const done = flashAmbd(chip.port, IMAGE, {
    onProgress: () => {},
    onLog: (line) => log.push(line),
    ...hooks,
  });
  return { chip, log, done };
}

const written = (chip: ReturnType<typeof fakeAmbd>) =>
  IMAGE.image.runs.every((r) => r.data.every((b, i) => chip.flash[r.address + i] === b));

describe("checksum32", () => {
  it("sums little-endian words and shifts the tail bytes in", () => {
    expect(checksum32(new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0]))).toBe(3);
    expect(checksum32(new Uint8Array([0, 0, 0, 0x80, 0, 0, 0, 0x80]))).toBe(0);
    expect(checksum32(new Uint8Array([1, 0, 0, 0, 0x34, 0x12]))).toBe(0x1235);
  });
});

describe("flashAmbd", () => {
  it("resets into the ROM over DTR/RTS, loads the loader, writes, verifies and boots the firmware", async () => {
    const onWaiting = vi.fn();
    const { chip, log, done } = flash({ ota2Valid: true }, { onWaiting });
    await expect(driveFakeTimers(done)).resolves.toBe(true);
    expect(onWaiting).not.toHaveBeenCalled();
    // One open, at the log speed; no baud change.
    expect(chip.bauds).toEqual([115200]);
    expect(chip.commands).not.toContainEqual(expect.stringMatching(/^baud/));
    // The loader went in first, then the one run; the reboot at the end dropped it again.
    expect(chip.commands.filter((c) => c === "xmodem")).toHaveLength(2);
    expect(chip.ram.subarray(0, LOADER.length)).toEqual(LOADER);
    expect(chip.loaderUp).toBe(false);
    expect(written(chip)).toBe(true);
    // The whole run's sectors were erased first; nothing else in ota1 was.
    expect([...chip.erased].sort((a, b) => a - b)).toEqual([OTA1_OFFSET, OTA2_OFFSET]);
    // The second slot's signature is gone, so the bootloader starts the first.
    expect(chip.flash.subarray(OTA2_OFFSET, OTA2_OFFSET + 8)).not.toEqual(
      IMAGE_SIGNATURE
    );
    expect(
      chip.flash.subarray(OTA2_OFFSET, OTA2_OFFSET + 0x1000).every((b) => b === 0xff)
    ).toBe(true);
    expect(chip.commands).toContain(`erase 0x${OTA2_OFFSET.toString(16)} x1`);
    expect(chip.booted).toBe(1);
    expect(chip.raw.readable).toBeNull();
    expect(log).toContainEqual(expect.stringContaining("4 MiB"));
    expect(log).toContainEqual(expect.stringMatching(/^Verified 0x6000/));
  });

  it("reports progress per block and lands on 100", async () => {
    const percents: number[] = [];
    const { done } = flash({}, { onProgress: (p) => percents.push(p) });
    await driveFakeTimers(done);
    expect(percents[percents.length - 1]).toBe(100);
    expect(percents.slice(0, -1).every((p) => p < 100)).toBe(true);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
  });

  it("retries the reset when a CH340 loses the first pulse", async () => {
    const { chip, log, done } = flash({ lostResets: 1 });
    await expect(driveFakeTimers(done)).resolves.toBe(true);
    expect(log).toContainEqual(expect.stringContaining("attempt 2 of 3"));
    expect(written(chip)).toBe(true);
  });

  it("waits for the strap when the resets reach nothing", async () => {
    let chip!: ReturnType<typeof fakeAmbd>;
    const onWaiting = vi.fn(() => chip.strap());
    const run = flash({ lostResets: 99 }, { onWaiting });
    chip = run.chip;
    await expect(driveFakeTimers(run.done)).resolves.toBe(true);
    expect(onWaiting).toHaveBeenCalledOnce();
    expect(run.log.some((l) => l.includes("LOG_TX to GND"))).toBe(true);
    expect(written(chip)).toBe(true);
  });

  it("reaches the strap guide on an adapter without control lines and leaves the reset to the user", async () => {
    let chip!: ReturnType<typeof fakeAmbd>;
    const onWaiting = vi.fn(() => chip.strap());
    const run = flash({ noSignals: true }, { onWaiting });
    chip = run.chip;
    await expect(driveFakeTimers(run.done)).resolves.toBe(false);
    expect(onWaiting).toHaveBeenCalledOnce();
    expect(written(chip)).toBe(true);
    expect(run.log).toContainEqual(expect.stringContaining("reset it by hand"));
  });

  it("skips the upload when the loader already runs, on an adapter that cannot reset it away", async () => {
    const chip = fakeAmbd({ loaderResident: true, noSignals: true });
    chip.ram.set(LOADER, 0);
    const log: string[] = [];
    await driveFakeTimers(
      flashAmbd(chip.port, IMAGE, { onProgress: () => {}, onLog: (l) => log.push(l) })
    );
    expect(log).toContain("The flash loader is already running");
    expect(chip.commands.filter((c) => c === "xmodem")).toHaveLength(1);
    expect(written(chip)).toBe(true);
  });

  it("takes a ROM that asks for CRC blocks, and one that NAKs the first block", async () => {
    for (const opts of [{ asksForCrc: true }, { nakFirstBlock: true }]) {
      const { chip, done } = flash(opts);
      await expect(driveFakeTimers(done)).resolves.toBe(true);
      expect(written(chip)).toBe(true);
    }
  });

  it("fails when no ROM answers before the strap wait runs out", async () => {
    const onWaiting = vi.fn();
    const { chip, done } = flash({ lostResets: 99 }, { onWaiting });
    await expect(driveFakeTimers(done)).rejects.toBeInstanceOf(AmbdLinkError);
    expect(onWaiting).toHaveBeenCalledOnce();
    expect(chip.raw.readable).toBeNull();
  });

  it("fails when the loader does not start", async () => {
    const { done } = flash({ loaderDead: true });
    await expect(driveFakeTimers(done)).rejects.toThrow(/flash id read/);
  });

  it("fails on a checksum that does not match, before clearing the second slot", async () => {
    const { chip, done } = flash({ badChecksum: true, ota2Valid: true });
    await expect(driveFakeTimers(done)).rejects.toBeInstanceOf(AmbdVerifyError);
    expect(chip.flash.subarray(OTA2_OFFSET, OTA2_OFFSET + 8)).toEqual(IMAGE_SIGNATURE);
    expect(chip.raw.readable).toBeNull();
  });

  it("never opens the port when the loader cannot be fetched", async () => {
    mocks.loadAmbdLoader.mockRejectedValueOnce(
      new AmbdLoaderError("firmware.rtl_ambd_loader_unavailable", "HTTP 404")
    );
    const chip = fakeAmbd();
    await expect(
      driveFakeTimers(flashAmbd(chip.port, IMAGE, { onProgress: () => {} }))
    ).rejects.toMatchObject({ key: "firmware.rtl_ambd_loader_unavailable" });
    expect(chip.raw.open).not.toHaveBeenCalled();
    // Retry fetches again (the loader forgets a failed fetch) and goes through.
    await expect(
      driveFakeTimers(flashAmbd(chip.port, IMAGE, { onProgress: () => {} }))
    ).resolves.toBe(true);
  });

  it("names a board that goes away mid-transfer and releases the port", async () => {
    const chip = fakeAmbd();
    const done = flashAmbd(chip.port, IMAGE, {
      onProgress: (p) => {
        if (p >= 30) chip.dropLink();
      },
    });
    await expect(driveFakeTimers(done)).rejects.toBeInstanceOf(SerialDeviceLostError);
    expect(chip.raw.readable).toBeNull();
  });

  it("stops at the abort signal", async () => {
    const abort = new AbortController();
    const chip = fakeAmbd();
    const done = flashAmbd(chip.port, IMAGE, {
      onProgress: (p) => {
        if (p >= 30) abort.abort(new DOMException("stopped", "AbortError"));
      },
      signal: abort.signal,
    });
    await expect(driveFakeTimers(done)).rejects.toMatchObject({ name: "AbortError" });
    expect(chip.raw.readable).toBeNull();
  });
});
