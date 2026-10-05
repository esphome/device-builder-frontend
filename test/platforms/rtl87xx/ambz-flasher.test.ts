import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveFakeTimers } from "../../_fake-timers.js";
import {
  AmbzLinkError,
  flashAmbz,
  pickSlot,
} from "../../../src/platforms/rtl87xx/ambz-flasher.js";
import { parseAmbzImage } from "../../../src/platforms/rtl87xx/ambz-image.js";
import {
  SerialDeviceLostError,
  SerialOpenTimeoutError,
} from "../../../src/util/serial-open-error.js";
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
  it("links to a board in download mode, writes at 115200 and leaves the reset to the user", async () => {
    const onWaiting = vi.fn();
    const { chip, done } = flash({}, { onWaiting });
    await expect(driveFakeTimers(done)).resolves.toBeUndefined();
    expect(onWaiting).not.toHaveBeenCalled();
    expect(chip.bauds.slice(0, 2)).toEqual([1500000, 115200]);
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

  it("pulses RTS, then waits for the strap, when no ROM answers", async () => {
    let chip!: ReturnType<typeof fakeAmbz>;
    const onWaiting = vi.fn(() => chip.strap());
    const run = flash({ strapped: false }, { onWaiting });
    chip = run.chip;
    await expect(driveFakeTimers(run.done)).resolves.toBeUndefined();
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
    const run = flash({ strapped: false, noSignals: true }, { onWaiting });
    chip = run.chip;
    await expect(driveFakeTimers(run.done)).resolves.toBeUndefined();
    expect(onWaiting).toHaveBeenCalledOnce();
  });

  it("gives up when no ROM answers while the guide is shown, and releases the port", async () => {
    const { chip, done } = flash({ strapped: false });
    await expect(driveFakeTimers(done)).rejects.toBeInstanceOf(AmbzLinkError);
    expect(chip.raw.readable).toBeNull();
    expect(chip.flash[0xb000]).not.toBe(IMAGE.ota1.runs[0].data[0]);
  });

  it("stops on abort while it waits for the strap", async () => {
    const abort = new AbortController();
    const { chip, done } = flash(
      { strapped: false },
      { signal: abort.signal, onWaiting: () => abort.abort() }
    );
    await expect(driveFakeTimers(done)).rejects.toMatchObject({ name: "AbortError" });
    expect(chip.raw.readable).toBeNull();
  });

  it("resends a block the ROM NAKs", async () => {
    const { chip, done } = flash({ nakFirstBlock: true });
    await expect(driveFakeTimers(done)).resolves.toBeUndefined();
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
  });

  it("closes a port that opens only after the reopen gave up", async () => {
    const { chip, done } = flash({});
    const open = chip.raw.open.getMockImplementation()!;
    // The reopen at the write speed lands well after its deadline.
    chip.raw.open.mockImplementationOnce(open).mockImplementationOnce(async (options) => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await open(options);
    });
    await expect(driveFakeTimers(done)).rejects.toBeInstanceOf(SerialOpenTimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    expect(chip.bauds).toEqual([1500000, 115200]);
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
  it("does not write it back when a second read disagrees", async () => {
    const { chip, done } = flash({ ota2Address: 0x08100000, garblesFirstRead: true });
    const before = chip.flash.slice(0x9000, 0xa000);
    await expect(driveFakeTimers(done)).rejects.toThrow(
      /system data read back differently/
    );
    expect(chip.flash.slice(0x9000, 0xa000)).toEqual(before);
    expect(chip.raw.readable).toBeNull();
  });

  it("writes no slot when the reads disagree and no rewrite is due", async () => {
    const { chip, done } = flash({ garblesFirstRead: true });
    const before = chip.flash.slice();
    await expect(driveFakeTimers(done)).rejects.toThrow(
      /system data read back differently/
    );
    // A plain loop over the 2 MiB flash; toEqual is too slow on CI.
    expect(chip.flash.every((b, i) => b === before[i])).toBe(true);
  });
});

describe("flashAmbz, a ROM slow to take the first block", () => {
  it("fails, not hangs, when the ROM keeps NAKing instead of ACKing the baud change", async () => {
    const { chip, done } = flash({ missesBaudChange: true });
    await expect(driveFakeTimers(done)).rejects.toThrow(
      /No ACK after the baud rate change/
    );
    expect(chip.raw.readable).toBeNull();
  });

  it("takes the baud change's ACK past an idle NAK", async () => {
    const { done } = flash({ naksBeforeBaudAck: true });
    await expect(driveFakeTimers(done)).resolves.toBeUndefined();
  });

  it("lets the ROM finish its xmodem log before asking for the write speed again", async () => {
    const { done } = flash({ chattersAfterWriteMs: 10 });
    await expect(driveFakeTimers(done)).resolves.toBeUndefined();
  });

  it("stops, writing nothing, when the ROM asks for CRC blocks", async () => {
    const { chip, done } = flash({ asksForCrc: true });
    const before = chip.flash.slice(0xb000, 0xc000);
    await expect(driveFakeTimers(done)).rejects.toThrow(/CRC/);
    expect(chip.flash.slice(0xb000, 0xc000)).toEqual(before);
    expect(chip.raw.readable).toBeNull();
  });

  it("waits for the receiver's NAK before the first block", async () => {
    const { chip, done } = flash({ readyAfterMs: 1100 });
    await expect(driveFakeTimers(done)).resolves.toBeUndefined();
    expect(written(chip)).toBe(true);
  });
});
