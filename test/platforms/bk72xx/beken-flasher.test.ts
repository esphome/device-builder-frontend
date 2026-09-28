import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveFakeTimers } from "../../_fake-timers.js";
import { flashBeken } from "../../../src/platforms/bk72xx/beken-flasher.js";
import type { LibreTinyImage } from "../../../src/platforms/libretiny-uf2.js";
import {
  BK7231N,
  BK7231T,
  BK7238,
  BK7252,
  count,
  expectImage,
  FAMILY,
  flash,
  isCommand,
  last,
} from "./_beken-flash.js";
import { fakeBeken, newByte, oldByte, referenceImage } from "./_fake-beken.js";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("flashBeken", () => {
  it.each([
    ["BK7231N", BK7231N, FAMILY.n, "BK7231N, bootloader BK7231N 1.0.1, flash eb6015"],
    ["BK7238", BK7238, FAMILY.bk7238, "BK7238, bootloader BK7238 1.0.14, flash 1c7015"],
    ["BK7231T", BK7231T, FAMILY.t, "BK7231T, bootloader BK7231S 1.0.5, version 1.0.5"],
    ["BK7251", BK7252, FAMILY.bk7251, "BK7252, bootloader BK7252 0.1.3"],
  ])(
    "writes and verifies every run on a %s, then boots it",
    async (_n, spec, family, chipLine) => {
      const image = referenceImage(family);
      const onLinked = vi.fn();
      const onWaiting = vi.fn();
      const { chip, log, progress, done } = flash(
        spec,
        image,
        {},
        { onLinked, onWaiting }
      );

      await driveFakeTimers(done);

      expectImage(chip, image);
      // Around the image the flash is as it was, or erased with its sector.
      expect(chip.flash[0x10fff]).toBe(oldByte(0x10fff));
      expect(chip.flash[0x14000]).toBe(oldByte(0x14000));
      expect(chip.flash[0x11000 + 0x2000 + 1000]).toBe(0xff);
      expect(chip.flash[0x129f09]).toBe(0xff);
      expect(log).toEqual([
        "Looking for the chip's downloader",
        `Linked: ${chipLine}, 2 MiB; 2 runs to write`,
        "Writing 0x11000 (9192 bytes)",
        "Writing 0x11000: 44%",
        "Writing 0x11000: 89%",
        "Writing 0x11000: 100%",
        "Wrote 0x11000 (CRC-32 of every sector written matches)",
        "Writing 0x129F0A (102 bytes)",
        "Writing 0x129F0A: 100%",
        "Wrote 0x129F0A (CRC-32 of every sector written matches)",
        "Rebooting into the firmware",
      ]);
      expect(chip.raw.open).toHaveBeenCalledWith({ baudRate: 115200 });
      // Both lines released, and no reset: the chip answered as it was.
      expect(chip.signals).toEqual([{ dataTerminalReady: false, requestToSend: false }]);
      expect(onLinked).toHaveBeenCalledOnce();
      expect(onWaiting).not.toHaveBeenCalled();
      expect(last(progress)).toBe(100);
      expect(progress.every((p, i) => i === 0 || p >= progress[i - 1])).toBe(true);
      expect(last(chip.sent())).toEqual(
        new Uint8Array([0x01, 0xe0, 0xfc, 0x02, 0x0e, 0xa5])
      );
      expect(chip.raw.close).toHaveBeenCalledOnce();
    }
  );

  it("clears the protection of the flash on the BootROM protocol, and leaves the rest of its status", async () => {
    const { chip, done } = flash({ ...BK7231N, sr: 0x437e }, referenceImage(FAMILY.n));

    await driveFakeTimers(done);

    expect(chip.statusRegister()).toBe(0x0302);
  });

  it("writes a status register of one byte as one byte", async () => {
    const { chip, done } = flash(BK7238, referenceImage(FAMILY.bk7238));

    await driveFakeTimers(done);

    expect(chip.statusRegister()).toBe(0);
    const writes = chip.sent().filter((f) => isCommand(f, 0x0d, true));
    expect(writes.every((f) => f.length === 10)).toBe(true);
  });

  it("does not touch the status register under a bootloader's protocol", async () => {
    const { chip, done } = flash(BK7231T, referenceImage(FAMILY.t));

    await driveFakeTimers(done);

    expect(count(chip, 0x0c, true)).toBe(0);
    expect(count(chip, 0x0d, true)).toBe(0);
    expect(count(chip, 0x0e, true)).toBe(0);
  });

  it("erases a sector that is all FF and does not write it", async () => {
    const image = referenceImage(FAMILY.n);
    const { chip, done } = flash(BK7231N, image);

    await driveFakeTimers(done);

    // Three sectors of the first run and the one of the second are erased,
    // two are written whole and one page goes into the last.
    expect(count(chip, 0x0f, true)).toBe(4);
    expect(count(chip, 0x07, true)).toBe(2);
    expect(count(chip, 0x06, true)).toBe(1);
    expect(chip.flash.subarray(0x12000, 0x13000).every((b) => b === 0xff)).toBe(true);
  });

  it("writes a run that starts inside a sector page by page up to the sector's end", async () => {
    const data = Uint8Array.from({ length: 0x300 + 5000 }, (_, i) => newByte(i));
    const image: LibreTinyImage = {
      familyId: FAMILY.t,
      board: "generic",
      runs: [{ address: 0x11d05, data }],
      totalBytes: data.length,
    };
    const { chip, done } = flash(BK7231T, image);

    await driveFakeTimers(done);

    expectImage(chip, image);
    // 0x11D05 to 0x12000 in pages (251, 256, 256 bytes), the rest in sectors.
    expect(count(chip, 0x06, true)).toBe(3);
    expect(count(chip, 0x07, true)).toBe(2);
    expect(chip.flash.subarray(0x11000, 0x11d05).every((b) => b === 0xff)).toBe(true);
  });

  it("resets the chip over the lines when it does not answer, again when the pulse is lost", async () => {
    const onWaiting = vi.fn();
    const { chip, log, done } = flash(
      BK7231N,
      referenceImage(FAMILY.n),
      { resetsNeeded: 2 },
      { onWaiting }
    );

    await driveFakeTimers(done);

    expect(onWaiting).not.toHaveBeenCalled();
    expect(log.slice(0, 3)).toEqual([
      "Looking for the chip's downloader",
      "No answer; resetting the chip over DTR/RTS",
      "No answer; resetting again (attempt 2 of 3)",
    ]);
    expect(chip.signals.slice(1, 4)).toEqual([
      { dataTerminalReady: true, requestToSend: true },
      { dataTerminalReady: false },
      { requestToSend: false },
    ]);
    expectImage(chip, referenceImage(FAMILY.n));
  });

  it("shows the guide after three resets and keeps polling until the chip is reset by hand", async () => {
    const onWaiting = vi.fn();
    const onLinked = vi.fn();
    const { chip, log, done } = flash(
      BK7231T,
      referenceImage(FAMILY.t),
      { resetsNeeded: 100 },
      { onWaiting, onLinked }
    );
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onWaiting).toHaveBeenCalledOnce();
    expect(onLinked).not.toHaveBeenCalled();
    expect(last(log)).toMatch(/waiting for the chip to be reset/);

    chip.reset();
    await driveFakeTimers(done);

    expect(onLinked).toHaveBeenCalledOnce();
    expectImage(chip, referenceImage(FAMILY.t));
  });

  it("goes to the guide at once on an adapter without lines to drive", async () => {
    const onWaiting = vi.fn();
    const { chip, log, done } = flash(
      BK7231N,
      referenceImage(FAMILY.n),
      { noSignals: true, linkAfter: 1000 },
      { onWaiting }
    );

    await driveFakeTimers(done);

    expect(onWaiting).toHaveBeenCalledOnce();
    expect(log).not.toContain("No answer; resetting the chip over DTR/RTS");
    expect(chip.signals).toEqual([]);
    expectImage(chip, referenceImage(FAMILY.n));
  });

  it("stops at the first reset when the lines cannot be driven any more", async () => {
    const onWaiting = vi.fn();
    const { chip, log, done } = flash(
      BK7231N,
      referenceImage(FAMILY.n),
      { resetsNeeded: 100 },
      { onWaiting }
    );
    chip.raw.setSignals
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {
        throw new DOMException("gone", "NetworkError");
      });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(onWaiting).toHaveBeenCalledOnce();
    expect(log).not.toContain("No answer; resetting again (attempt 2 of 3)");
    chip.reset();
    await driveFakeTimers(done);
  });

  it("takes the chip's own word over its bootloader's", async () => {
    // A BK7238 that carries the bootloader known from the BK7231N.
    const { done } = flash({ ...BK7238, boot_crc: 0xe14191ba }, referenceImage(FAMILY.n));

    await expect(driveFakeTimers(done)).rejects.toMatchObject({ found: "BK7238" });
  });

  it("keeps the bootloader's chip when the chip names one that is not known", async () => {
    const { chip, log, done } = flash(
      { ...BK7231N, chip_id: 0x1234 },
      referenceImage(FAMILY.n)
    );

    await driveFakeTimers(done);

    expect(log).toContain("Chip id not known: 0x1234");
    expect(log.find((l) => l.startsWith("Linked: "))).toContain("Linked: BK7231N,");
    expectImage(chip, referenceImage(FAMILY.n));
  });

  it.each([
    ["the BootROM's", { ...BK7231N, boot_crc: null }, "unknown chip"],
    ["a bootloader's", { ...BK7252, boot_crc: null }, "unknown chip"],
  ] as const)(
    "tells %s protocol for a bootloader that is not known",
    async (_name, spec, line) => {
      // The chip id of the BootROM is not read here, so the chip stays unknown.
      const { chip, log, done } = flash(
        { ...spec, chip_id: 0 },
        referenceImage(FAMILY.bk7238)
      );

      await driveFakeTimers(done);

      expect(log[1]).toMatch(
        /Bootloader not known \(CRC [0-9a-f]+\); probing the protocol/
      );
      expect(log.find((l) => l.startsWith("Linked: "))).toContain(
        `Linked: ${line}, unknown bootloader`
      );
      // A chip that could not be told is written whatever the image was built for.
      expectImage(chip, referenceImage(FAMILY.bk7238));
    }
  );

  it.each([
    ["\u0007", "BK7231T, bootloader BK7231S 1.0.5, 2 MiB"],
    ["\0 1.0.5 \0", "BK7231T, bootloader BK7231S 1.0.5, version 1.0.5, 2 MiB"],
  ])("reads the bootloader's version where it has one (%j)", async (version, line) => {
    const { log, done } = flash(
      { ...BK7231T, boot_version: version },
      referenceImage(FAMILY.t)
    );

    await driveFakeTimers(done);

    expect(log[1]).toBe(`Linked: ${line}; 2 runs to write`);
  });

  it("finds the size of the flash where an address comes round to the same sector", async () => {
    const { chip, log, done } = flash(BK7252, referenceImage(FAMILY.bk7251));

    await driveFakeTimers(done);

    expect(log[1]).toContain("2 MiB");
    // The sector at 0x11000 and the one a flash size further.
    expect(count(chip, 0x09, true)).toBe(2);
  });

  it("looks at the next erase when the first sector is erased already", async () => {
    const image = referenceImage(FAMILY.n);
    const { chip, done } = flash(BK7231N, image);
    chip.flash.fill(0xff, 0x11000, 0x12000);

    await driveFakeTimers(done);

    expectImage(chip, image);
    // The first sector is not erased again; the erase of the second is the
    // one that is looked at.
    expect(count(chip, 0x0f, true)).toBe(3);
  });

  it("erases and writes a sector again when its CRC does not match", async () => {
    const image = referenceImage(FAMILY.t);
    const { chip, log, done } = flash(BK7231T, image, { badCrcs: 1 });

    await driveFakeTimers(done);

    expectImage(chip, image);
    expect(log).toContain("Writing 0x11000 failed, erasing and writing again");
    expect(count(chip, 0x07, true)).toBe(3);
    expect(count(chip, 0x0f, true)).toBe(5);
  });

  it("writes a sector again when the chip does not answer the write", async () => {
    const image = referenceImage(FAMILY.n);
    const { chip, done } = flash(BK7231N, image, { swallowWrites: 1 });

    await driveFakeTimers(done);

    expectImage(chip, image);
    expect(count(chip, 0x07, true)).toBe(3);
  });

  it("reads past what is not a response, and past the response of another command", async () => {
    const image = referenceImage(FAMILY.n);
    const { chip, done } = flash(BK7231N, image, {
      noise: new Uint8Array([0x00, 0x55, 0xaa, 0x04, 0x01, 0xe0, 0xfc]),
      strayResponse: true,
    });

    await driveFakeTimers(done);

    expectImage(chip, image);
  });

  it("uses a port that is open already", async () => {
    const chip = fakeBeken(BK7231N);
    await chip.raw.open();
    chip.raw.open.mockClear();

    await driveFakeTimers(
      flashBeken(chip.port, referenceImage(FAMILY.n), { onProgress: () => {} })
    );

    expect(chip.raw.open).not.toHaveBeenCalled();
    expectImage(chip, referenceImage(FAMILY.n));
  });
});
