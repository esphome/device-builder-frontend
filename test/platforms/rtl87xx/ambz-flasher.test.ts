import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveFakeTimers } from "../../_fake-timers.js";
import {
  AmbzLinkError,
  flashAmbz,
  pickSlot,
} from "../../../src/platforms/rtl87xx/ambz-flasher.js";
import { parseAmbzImage } from "../../../src/platforms/rtl87xx/ambz-image.js";
import { SerialDeviceLostError } from "../../../src/util/serial-open-error.js";
import { fakeAmbz, type FakeAmbzOptions, fixtureUf2 } from "./_fake-ambz.js";

const UF2 = await fixtureUf2();
const IMAGE = parseAmbzImage(UF2);
const OTA2 = 0x80000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

function flash(
  opts: FakeAmbzOptions = {},
  hooks: Partial<Parameters<typeof flashAmbz>[2]> = {}
) {
  const chip = fakeAmbz({ ota2Address: 0x08000000 | OTA2, ...opts });
  const log: string[] = [];
  const done = flashAmbz(chip.port, IMAGE, {
    onProgress: () => {},
    onLog: (line) => log.push(line),
    ...hooks,
  });
  return { chip, log, done };
}

const written = (chip: ReturnType<typeof fakeAmbz>, image = IMAGE.ota1) =>
  image.runs.every((r) => r.data.every((b, i) => chip.flash[r.address + i] === b));

describe("flashAmbz", () => {
  it("reboots a running LibreTiny into download mode, writes at 115200 and boots", async () => {
    const onWaiting = vi.fn();
    const { chip, done } = flash({ start: "firmware" }, { onWaiting });
    await expect(driveFakeTimers(done)).resolves.toBe(true);
    expect(onWaiting).not.toHaveBeenCalled();
    expect(chip.bauds.slice(0, 3)).toEqual([115200, 1500000, 115200]);
    expect(chip.booted()).toBe(true);
    expect(written(chip)).toBe(true);
    // Released at the end, for the logs to reopen.
    expect(chip.raw.readable).toBeNull();
  });

  it("writes the slot the system data selects", async () => {
    const { chip, done } = flash({ ota2Switch: 0xfffffffe });
    await driveFakeTimers(done);
    expect(written(chip, IMAGE.ota2)).toBe(true);
    expect(written(chip, IMAGE.ota1)).toBe(false);
  });

  it("pulses RTS, then waits for the strap, when the firmware does not answer the magic", async () => {
    let chip!: ReturnType<typeof fakeAmbz>;
    const onWaiting = vi.fn(() => chip.strap());
    const run = flash({ start: "firmware", ignoresMagic: true }, { onWaiting });
    chip = run.chip;
    await expect(driveFakeTimers(run.done)).resolves.toBe(true);
    expect(onWaiting).toHaveBeenCalledOnce();
    expect(chip.signals).toContainEqual({
      dataTerminalReady: false,
      requestToSend: true,
    });
    expect(run.log.some((l) => l.includes("TX2 to GND"))).toBe(true);
    expect(written(chip)).toBe(true);
  });

  it("reaches the strap guide on an adapter without control lines", async () => {
    let chip!: ReturnType<typeof fakeAmbz>;
    const onWaiting = vi.fn(() => chip.strap());
    const run = flash(
      { start: "firmware", ignoresMagic: true, noSignals: true },
      { onWaiting }
    );
    chip = run.chip;
    await expect(driveFakeTimers(run.done)).resolves.toBe(true);
    expect(onWaiting).toHaveBeenCalledOnce();
  });

  it("gives up when no ROM answers while the guide is shown, and releases the port", async () => {
    const { chip, done } = flash({ start: "firmware", ignoresMagic: true });
    await expect(driveFakeTimers(done)).rejects.toBeInstanceOf(AmbzLinkError);
    expect(chip.raw.readable).toBeNull();
    expect(chip.flash[0xb000]).not.toBe(IMAGE.ota1.runs[0].data[0]);
  });

  it("stops on abort while it waits for the strap", async () => {
    const abort = new AbortController();
    const { chip, done } = flash(
      { start: "firmware", ignoresMagic: true },
      { signal: abort.signal, onWaiting: () => abort.abort() }
    );
    await expect(driveFakeTimers(done)).rejects.toMatchObject({ name: "AbortError" });
    expect(chip.raw.readable).toBeNull();
  });

  it("resends a block the ROM NAKs", async () => {
    const { chip, done } = flash({ nakFirstBlock: true });
    await expect(driveFakeTimers(done)).resolves.toBe(true);
    expect(written(chip)).toBe(true);
  });

  it("fails when the port goes away mid-transfer", async () => {
    let chip!: ReturnType<typeof fakeAmbz>;
    let dropped = false;
    const run = flash(
      {},
      {
        // The port is reopened at every speed, so it goes once a transfer is under way.
        onProgress: () => {
          if (dropped) return;
          dropped = true;
          chip.dropLink();
        },
      }
    );
    chip = run.chip;
    await expect(driveFakeTimers(run.done)).rejects.toThrow(SerialDeviceLostError);
    expect(chip.booted()).toBe(false);
  });

  it("closes a port that opens only after the reopen gave up", async () => {
    const { chip, done } = flash({ start: "firmware" });
    const open = chip.raw.open.getMockImplementation()!;
    // The reopen at the ROM's speed lands well after its deadline.
    chip.raw.open.mockImplementationOnce(open).mockImplementationOnce(async (options) => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await open(options);
    });
    await expect(driveFakeTimers(done)).rejects.toThrow("Reopening the port timed out");
    await vi.advanceTimersByTimeAsync(5000);
    expect(chip.bauds).toEqual([115200, 1500000]);
    expect(chip.raw.readable).toBeNull();
  });

  it("reports progress up to 100", async () => {
    const progress: number[] = [];
    const { done } = flash({}, { onProgress: (p) => progress.push(p) });
    await driveFakeTimers(done);
    expect(progress[progress.length - 1]).toBe(100);
    expect(progress.slice(0, -1).every((p) => p <= 99)).toBe(true);
  });
});

describe("pickSlot", () => {
  const system = (address: number, sw: number) => {
    const data = new Uint8Array(0x1000).fill(0x5a);
    const view = new DataView(data.buffer);
    view.setUint32(0, address, true);
    view.setUint32(4, sw, true);
    return data;
  };

  it.each([
    [0xffffffff, 1],
    [0xfffffffe, 2],
    [0xfffffffc, 1],
    [0x00000000, 1],
  ])("reads switch 0x%s as slot %s", (sw, slot) => {
    expect(pickSlot(system(0x08000000 | OTA2, sw), OTA2)).toEqual({
      slot,
      rewrite: null,
    });
  });

  it("points a stale ota2 address at this layout and erases the gaps", () => {
    const { slot, rewrite } = pickSlot(system(0x08100000, 0xfffffffe), OTA2);
    expect(slot).toBe(1);
    const view = new DataView(rewrite!.buffer);
    expect(view.getUint32(0, true)).toBe(0x08000000 | OTA2);
    expect(view.getUint32(4, true)).toBe(0xffffffff);
    expect(rewrite![0x08]).toBe(0x5a);
    expect(rewrite![0x09]).toBe(0xff);
    expect(rewrite![0x40]).toBe(0x5a);
    expect(rewrite![0x100]).toBe(0xff);
  });
});

describe("flashAmbz, a garbled system data read", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  it("does not write it back when a second read disagrees", async () => {
    const chip = fakeAmbz({ ota2Address: 0x08100000, garblesFirstRead: true });
    const before = chip.flash.slice(0x9000, 0xa000);
    const done = flashAmbz(chip.port, IMAGE, { onProgress: () => {} });
    await expect(driveFakeTimers(done)).rejects.toThrow(
      /system data read back differently/
    );
    expect(chip.flash.slice(0x9000, 0xa000)).toEqual(before);
    expect(chip.raw.readable).toBeNull();
  });

  it("writes no slot when the reads disagree and no rewrite is due", async () => {
    const chip = fakeAmbz({ ota2Address: 0x08000000 | 0x80000, garblesFirstRead: true });
    const before = chip.flash.slice();
    const done = flashAmbz(chip.port, IMAGE, { onProgress: () => {} });
    await expect(driveFakeTimers(done)).rejects.toThrow(
      /system data read back differently/
    );
    // A plain loop over the 2 MiB flash; toEqual is too slow on CI.
    expect(chip.flash.every((b, i) => b === before[i])).toBe(true);
    expect(chip.booted()).toBe(false);
  });
});

describe("flashAmbz, a ROM slow to take the first block", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  it("takes the baud change's ACK past an idle NAK", async () => {
    const chip = fakeAmbz({ ota2Address: 0x08000000 | 0x80000, naksBeforeBaudAck: true });
    const done = flashAmbz(chip.port, IMAGE, { onProgress: () => {} });
    await expect(driveFakeTimers(done)).resolves.toBe(true);
    expect(chip.booted()).toBe(true);
  });

  it("lets the ROM finish its xmodem log before asking for the write speed again", async () => {
    const chip = fakeAmbz({
      ota2Address: 0x08000000 | 0x80000,
      chattersAfterWriteMs: 10,
    });
    const done = flashAmbz(chip.port, IMAGE, { onProgress: () => {} });
    await expect(driveFakeTimers(done)).resolves.toBe(true);
    expect(chip.booted()).toBe(true);
  });

  it("waits for the receiver's NAK before the first block", async () => {
    const chip = fakeAmbz({ ota2Address: 0x08000000 | 0x80000, readyAfterMs: 1100 });
    const done = flashAmbz(chip.port, IMAGE, { onProgress: () => {} });
    await expect(driveFakeTimers(done)).resolves.toBe(true);
    expect(
      IMAGE.ota1.runs.every((r) =>
        r.data.every((b, i) => chip.flash[r.address + i] === b)
      )
    ).toBe(true);
  });
});
