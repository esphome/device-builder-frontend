import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveFakeTimers } from "../../_fake-timers.js";
import { BekenChipMismatchError } from "../../../src/platforms/bk72xx/beken-flasher.js";
import { SerialDeviceLostError } from "../../../src/util/serial-open-error.js";
import {
  BK7231N,
  BK7231T,
  BK7252,
  count,
  expectImage,
  FAMILY,
  flash,
} from "./_beken-flash.js";
import { oldByte, referenceImage } from "./_fake-beken.js";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("flashBeken with the image given for the linked chip", () => {
  it.each([
    ["BK7231N", BK7231N, "BK7231N", FAMILY.n],
    // The BK7231U shares the BK7231T's family, and the BK7252 is the BK7251's.
    ["BK7231T", BK7231T, "BK7231T", FAMILY.t],
    ["BK7252", BK7252, "BK7251", FAMILY.bk7251],
  ])(
    "asks for the %s's family after the link and writes it",
    async (found, spec, family, id) => {
      const image = referenceImage(id);
      const source = vi.fn(async () => image);
      const onLinked = vi.fn();
      const { chip, log, done } = flash(spec, source, {}, { onLinked });

      await driveFakeTimers(done);

      expect(source).toHaveBeenCalledExactlyOnceWith({ chip: found, family });
      expect(onLinked.mock.invocationCallOrder[0]).toBeLessThan(
        source.mock.invocationCallOrder[0]
      );
      expect(log.find((l) => l.startsWith("Linked: "))).toContain("2 runs to write");
      expectImage(chip, image);
    }
  );

  it("tells a chip it could not identify as neither chip nor family", async () => {
    const source = vi.fn(async () => referenceImage(FAMILY.bk7238));
    const { done } = flash({ ...BK7252, boot_crc: null, chip_id: 0 }, source);

    await driveFakeTimers(done);

    expect(source).toHaveBeenCalledWith({ chip: undefined, family: undefined });
  });

  it("still refuses an image for another chip before anything is erased", async () => {
    const { chip, done } = flash(BK7231N, async () => referenceImage(FAMILY.t));

    await expect(driveFakeTimers(done)).rejects.toBeInstanceOf(BekenChipMismatchError);

    expect(count(chip, 0x0f, true)).toBe(0);
    expect(chip.flash[0x11000]).toBe(oldByte(0x11000));
    expect(chip.raw.close).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "throws",
      () => {
        throw new Error("no image for the BK7231Q");
      },
    ],
    ["rejects", () => Promise.reject(new Error("no image for the BK7231Q"))],
  ])(
    "fails the flash when the source %s, before anything is erased",
    async (_n, source) => {
      const { chip, done } = flash(BK7231N, source);

      await expect(driveFakeTimers(done)).rejects.toThrow("no image for the BK7231Q");

      expect(count(chip, 0x0f, true)).toBe(0);
      expect(chip.flash[0x11000]).toBe(oldByte(0x11000));
      expect(chip.raw.close).toHaveBeenCalledOnce();
    }
  );

  // The source's download stays pending; only the abort or the unplug ends the wait.
  it.each([
    [
      "the user gives up",
      (_chip: unknown, abort: AbortController) => abort.abort(),
      { name: "AbortError" },
    ],
    [
      "the device goes away",
      (chip: { dropLink: () => void }) => chip.dropLink(),
      new SerialDeviceLostError(new Error("gone")),
    ],
  ])(
    "lets the port go at once when %s while the image is fetched",
    async (_n, stop, failure) => {
      const abort = new AbortController();
      let fetched!: () => void;
      const source = vi.fn(
        () =>
          new Promise<never>(
            (_resolve, reject) => (fetched = () => reject(new Error("late")))
          )
      );
      const { chip, done } = flash(BK7231N, source, {}, { signal: abort.signal });
      await vi.waitFor(async () => {
        await vi.advanceTimersByTimeAsync(10);
        expect(source).toHaveBeenCalled();
      });

      stop(chip, abort);

      await expect(driveFakeTimers(done)).rejects.toMatchObject(
        failure instanceof Error ? { name: failure.name } : failure
      );
      expect(chip.raw.close).toHaveBeenCalledOnce();
      expect(count(chip, 0x0f, true)).toBe(0);
      // The download settling later changes nothing.
      fetched();
      await vi.advanceTimersByTimeAsync(10);
    }
  );
});
