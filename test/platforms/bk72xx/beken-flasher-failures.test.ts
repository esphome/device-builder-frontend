import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveFakeTimers } from "../../_fake-timers.js";
import {
  BekenChipMismatchError,
  BekenLinkError,
  BekenResponseError,
  BekenUnknownFlashError,
  flashBeken,
} from "../../../src/platforms/bk72xx/beken-flasher.js";
import { BekenLink } from "../../../src/platforms/bk72xx/beken-link.js";
import type { LibreTinyImage } from "../../../src/platforms/libretiny-uf2.js";
import { SerialDeviceLostError } from "../../../src/util/serial-open-error.js";
import {
  BK7231N,
  BK7231T,
  BK7252,
  count,
  expectImage,
  FAMILY,
  flash,
  last,
} from "./_beken-flash.js";
import { fakeBeken, oldByte, referenceImage } from "./_fake-beken.js";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("flashBeken, when it cannot go on", () => {
  it("gives up when no chip answers while the guide is shown", async () => {
    const { chip, done } = flash(BK7231N, referenceImage(FAMILY.n), {
      resetsNeeded: 100,
    });
    // Five minutes of polling are more timers than one run of them takes.
    for (let minute = 0; minute < 6; minute++) {
      await vi.advanceTimersByTimeAsync(60_000);
    }

    await expect(driveFakeTimers(done)).rejects.toBeInstanceOf(BekenLinkError);

    expect(count(chip, 0x10, false)).toBe(0);
    expect(chip.raw.close).toHaveBeenCalledOnce();
  });

  it("refuses an image built for another chip before anything is erased", async () => {
    const { chip, done } = flash(BK7231N, referenceImage(FAMILY.t));

    await expect(driveFakeTimers(done)).rejects.toMatchObject({
      name: "BekenChipMismatchError",
      built: "BK7231T",
      found: "BK7231N",
    });
    await expect(done).rejects.toBeInstanceOf(BekenChipMismatchError);

    expect(count(chip, 0x0f, true)).toBe(0);
    expect(chip.flash[0x11000]).toBe(oldByte(0x11000));
    expect(chip.raw.close).toHaveBeenCalledOnce();
  });

  it("fails when the flash fits neither protocol", async () => {
    const { chip, done } = flash(
      { ...BK7252, boot_crc: null },
      referenceImage(FAMILY.t),
      {
        oddProbeCrc: true,
      }
    );

    await expect(driveFakeTimers(done)).rejects.toThrow(/fits neither protocol/);
    await expect(done).rejects.toBeInstanceOf(BekenResponseError);

    expect(count(chip, 0x0f, true)).toBe(0);
  });

  it("reads a sector again when the read fails or comes back short", async () => {
    const image = referenceImage(FAMILY.bk7251);
    const { chip, log, done } = flash(BK7252, image, { badReads: 1, shortReads: 2 });

    await driveFakeTimers(done);

    expectImage(chip, image);
    expect(log.filter((l) => l === "Reading 0x11000 failed, reading again")).toHaveLength(
      2
    );
    expect(count(chip, 0x09, true)).toBe(4);
  });

  it("gives up reading a sector after twenty one tries", async () => {
    const { chip, done } = flash(BK7252, referenceImage(FAMILY.bk7251), {
      badReads: 1000,
    });

    await expect(driveFakeTimers(done)).rejects.toThrow("FlashRead4K: status 1");

    expect(count(chip, 0x09, true)).toBe(21);
    expect(count(chip, 0x0f, true)).toBe(0);
  });

  it("fails when the size of the flash cannot be told", async () => {
    const { chip, done } = flash(BK7252, referenceImage(FAMILY.bk7251), {
      noWrapAround: true,
    });

    await expect(driveFakeTimers(done)).rejects.toThrow(
      "Could not tell the size of the flash"
    );

    // The sector itself, then one for each size a flash can have.
    expect(count(chip, 0x09, true)).toBe(5);
    expect(count(chip, 0x0f, true)).toBe(0);
  });

  it("fails when a page was not written whole", async () => {
    const { done } = flash(BK7231T, referenceImage(FAMILY.t), { shortPageWrites: true });

    await expect(driveFakeTimers(done)).rejects.toThrow("Wrote 111 of 112 bytes");
    await expect(done).rejects.toBeInstanceOf(BekenResponseError);
  });

  it("reports the flash's failure, not that of the teardown after it", async () => {
    const close = vi
      .spyOn(BekenLink.prototype, "close")
      .mockRejectedValue(new Error("close failed"));
    const { chip, done } = flash(BK7231N, referenceImage(FAMILY.t));

    await expect(driveFakeTimers(done)).rejects.toBeInstanceOf(BekenChipMismatchError);

    expect(chip.raw.close).toHaveBeenCalledOnce();
    close.mockRestore();
  });

  it("refuses a flash whose status register is not known, before anything is erased", async () => {
    const { chip, done } = flash(
      { ...BK7231N, flash_id: "123415" },
      referenceImage(FAMILY.n)
    );

    await expect(driveFakeTimers(done)).rejects.toMatchObject({
      name: "BekenUnknownFlashError",
      flashId: "123415",
    });
    await expect(done).rejects.toBeInstanceOf(BekenUnknownFlashError);

    expect(count(chip, 0x0f, true)).toBe(0);
  });

  it("names a flash that is not known whatever size its id gives", async () => {
    const { chip, done } = flash(
      { ...BK7231N, flash_id: "123400" },
      referenceImage(FAMILY.n)
    );

    await expect(driveFakeTimers(done)).rejects.toBeInstanceOf(BekenUnknownFlashError);

    expect(count(chip, 0x0f, true)).toBe(0);
  });

  it("fails when the flash keeps its protection", async () => {
    const { chip, done } = flash(BK7231N, referenceImage(FAMILY.n), {
      stuckProtection: true,
    });

    await expect(driveFakeTimers(done)).rejects.toThrow(
      /kept its protection \(status register 407c\)/
    );

    expect(count(chip, 0x0f, true)).toBe(0);
  });

  it("fails after four tries when an erase does not take", async () => {
    // Protected in a way the status register does not show.
    const { chip, log, done } = flash(BK7231N, referenceImage(FAMILY.n), {
      deadErase: true,
    });

    await expect(driveFakeTimers(done)).rejects.toThrow(
      /The erase at 0x11000 did not take; the flash is protected/
    );
    await expect(done).rejects.toBeInstanceOf(BekenResponseError);

    expect(log.filter((l) => l === "Erasing 0x11000 failed, erasing again")).toHaveLength(
      3
    );
    expect(count(chip, 0x0f, true)).toBe(4);
    expect(count(chip, 0x07, true)).toBe(0);
  });

  it("writes a sector again when the chip does not answer after its CRC", async () => {
    const image = referenceImage(FAMILY.t);
    const { chip, log, done } = flash(BK7231T, image, { deafAfterCrc: 1 });

    await driveFakeTimers(done);

    expectImage(chip, image);
    expect(log).toContain("Writing 0x11000 failed, erasing and writing again");
  });

  it("names the chip that stopped answering after a CRC, not the CRC", async () => {
    const { done } = flash(BK7231T, referenceImage(FAMILY.t), { deafAfterCrc: 100 });

    await expect(driveFakeTimers(done)).rejects.toThrow(
      "The chip did not answer after the CRC"
    );
    await expect(done).rejects.toBeInstanceOf(BekenResponseError);
  });

  it("fails after eleven tries when a sector's CRC never matches", async () => {
    const { chip, log, done } = flash(BK7231T, referenceImage(FAMILY.t), {
      badCrcs: 100,
    });

    await expect(driveFakeTimers(done)).rejects.toThrow(
      /The CRC of the flash at 0x11000 is [0-9a-f]+, not [0-9a-f]+/
    );

    expect(
      log.filter((l) => l === "Writing 0x11000 failed, erasing and writing again")
    ).toHaveLength(10);
    expect(count(chip, 0x07, true)).toBe(11);
    expect(last(chip.sent())?.[4]).not.toBe(0x0e);
  });

  it("refuses a run that does not fit the flash, before the runs ahead of it are written", async () => {
    const image: LibreTinyImage = {
      familyId: FAMILY.n,
      board: "generic",
      runs: [
        { address: 0x11000, data: new Uint8Array(0x1000).fill(1) },
        { address: 0x1ff000, data: new Uint8Array(0x2000) },
      ],
      totalBytes: 0x3000,
    };
    const { chip, done } = flash(BK7231N, image);

    await expect(driveFakeTimers(done)).rejects.toThrow(
      /run at 0x1FF000 does not fit the flash of 2097152 bytes/
    );

    // No erase and no write, of a sector or of the status register.
    expect(count(chip, 0x0f, true)).toBe(0);
    expect(count(chip, 0x07, true)).toBe(0);
    expect(count(chip, 0x0d, false)).toBe(0);
  });

  it("stops on abort and releases the port", async () => {
    const abort = new AbortController();
    const { chip, done } = flash(
      BK7231N,
      referenceImage(FAMILY.n),
      { resetsNeeded: 100 },
      { signal: abort.signal }
    );
    await vi.advanceTimersByTimeAsync(3000);

    abort.abort();

    await expect(driveFakeTimers(done)).rejects.toMatchObject({ name: "AbortError" });
    expect(count(chip, 0x10, false)).toBe(0);
    expect(chip.raw.close).toHaveBeenCalledOnce();
  });

  it("closes a port that opened without streams instead of leaving it held", async () => {
    const chip = fakeBeken(BK7231N);
    chip.raw.open.mockImplementation(async () => {});

    await expect(
      driveFakeTimers(
        flashBeken(chip.port, referenceImage(FAMILY.n), { onProgress: () => {} })
      )
    ).rejects.toThrow(/no readable/);

    expect(chip.raw.close).toHaveBeenCalledOnce();
  });

  it("fails when the port goes away while it waits for the chip", async () => {
    const { chip, done } = flash(BK7231N, referenceImage(FAMILY.n), {
      resetsNeeded: 100,
    });
    await vi.advanceTimersByTimeAsync(1000);

    chip.dropLink();

    await expect(driveFakeTimers(done)).rejects.toThrow(SerialDeviceLostError);
    expect(chip.raw.close).toHaveBeenCalledOnce();
  });

  it("fails when the port goes away in the middle of a write", async () => {
    const { chip, done } = flash(BK7231N, referenceImage(FAMILY.n), {
      swallowWrites: 100,
    });
    // The write is out and its answer does not come: the board was unplugged.
    await vi.advanceTimersByTimeAsync(500);
    expect(count(chip, 0x07, true)).toBe(1);

    chip.dropLink();

    await expect(driveFakeTimers(done)).rejects.toThrow(SerialDeviceLostError);
    expect(count(chip, 0x07, true)).toBe(1);
    expect(chip.raw.close).toHaveBeenCalledOnce();
  });

  it("reports the failure when the close never returns", async () => {
    const { chip, done } = flash(BK7231N, referenceImage(FAMILY.n), {
      resetsNeeded: 100,
    });
    await vi.advanceTimersByTimeAsync(1000);
    chip.raw.close.mockReturnValue(new Promise(() => {}));

    chip.dropLink();

    await expect(driveFakeTimers(done)).rejects.toThrow(SerialDeviceLostError);
  });
});
