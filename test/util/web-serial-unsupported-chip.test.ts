/**
 * @vitest-environment happy-dom
 *
 * esptool-js maps the magic-register value 0 to ESP32-P4, so newer chips it
 * has no target for (ESP32-S31, H21, H4, E22) are misdetected as a P4 and the
 * P4 stub upload then wedges the session (espressif/esptool-js#248, #1114).
 * ``connectToPort`` cross-checks the GET_SECURITY_INFO chip_id before the
 * stub upload and refuses with ``UnsupportedChipError``; anything short of a
 * confirmed mismatch fails open to today's behaviour.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
  chip: { CHIP_NAME: string } | null;
  securityInfo: () => Promise<[number, Uint8Array]>;
  stubRuns: number;
  commandOps: number[];
} = {
  chip: null,
  securityInfo: () => Promise.reject(new Error("unset")),
  stubRuns: 0,
  commandOps: [],
};

vi.mock("esptool-js", () => {
  class Transport {
    constructor(
      public port: unknown,
      public trace: boolean
    ) {}

    async disconnect() {}
  }
  class ESPLoader {
    chip: { CHIP_NAME: string } | null = null;

    constructor(public options: unknown) {}

    async command(op: number): Promise<[number, Uint8Array]> {
      state.commandOps.push(op);
      return state.securityInfo();
    }

    async runStub() {
      state.stubRuns += 1;
      return this.chip;
    }

    // Mirrors the real main() order: chip detection first, stub upload after.
    async main() {
      this.chip = state.chip;
      await this.runStub();
      return this.chip?.CHIP_NAME ?? "unknown";
    }
  }
  class UsbJtagSerialReset {}
  return { ESPLoader, Transport, UsbJtagSerialReset };
});

import { connectToPort, UnsupportedChipError } from "../../src/util/web-serial.js";

const GET_SECURITY_INFO = 0x14;

const fakePort = { close: vi.fn().mockResolvedValue(undefined) } as unknown as SerialPort;

// 20-byte security-info payload (flags, flash_crypt_cnt, key_purposes,
// chip_id, api_version) plus 2 trailing status bytes.
function securityInfo(chipId: number): [number, Uint8Array] {
  const data = new Uint8Array(22);
  new DataView(data.buffer).setUint32(12, chipId, true);
  return [0, data];
}

beforeEach(() => {
  state.chip = { CHIP_NAME: "ESP32-P4" };
  state.securityInfo = () => Promise.reject(new Error("unset"));
  state.stubRuns = 0;
  state.commandOps = [];
});

describe("connectToPort — misdetected-P4 guard", () => {
  it("refuses an ESP32-S31 before the stub upload", async () => {
    state.securityInfo = () => Promise.resolve(securityInfo(32));

    const err = await connectToPort(fakePort).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnsupportedChipError);
    expect((err as UnsupportedChipError).chipName).toBe("ESP32-S31");
    expect(state.stubRuns).toBe(0);
    expect(state.commandOps).toEqual([GET_SECURITY_INFO]);
  });

  it("names an unknown chip id it has no name for", async () => {
    state.securityInfo = () => Promise.resolve(securityInfo(99));

    const err = await connectToPort(fakePort).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnsupportedChipError);
    expect((err as UnsupportedChipError).chipName).toBe(
      "unsupported ESP chip (chip id 99)"
    );
  });

  it("lets a genuine ESP32-P4 through to the stub", async () => {
    state.securityInfo = () => Promise.resolve(securityInfo(18));

    const detected = await connectToPort(fakePort);

    expect(detected.chipName).toBe("ESP32-P4");
    expect(state.stubRuns).toBe(1);
  });

  it("fails open when GET_SECURITY_INFO errors", async () => {
    state.securityInfo = () => Promise.reject(new Error("command not supported"));

    const detected = await connectToPort(fakePort);

    expect(detected.chipName).toBe("ESP32-P4");
    expect(state.stubRuns).toBe(1);
  });

  it("fails open on a response too short to carry a chip id", async () => {
    state.securityInfo = () => Promise.resolve([0, new Uint8Array(15)]);

    await connectToPort(fakePort);

    expect(state.stubRuns).toBe(1);
  });

  it("refuses on the minimal 16-byte response carrying a chip id", async () => {
    state.securityInfo = () => {
      const data = new Uint8Array(16);
      new DataView(data.buffer).setUint32(12, 32, true);
      return Promise.resolve([0, data]);
    };

    const err = await connectToPort(fakePort).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnsupportedChipError);
    expect(state.stubRuns).toBe(0);
  });

  it("never queries security info on a non-P4 detection", async () => {
    state.chip = { CHIP_NAME: "ESP32-S3" };

    const detected = await connectToPort(fakePort);

    expect(detected.chipName).toBe("ESP32-S3");
    expect(state.commandOps).toEqual([]);
    expect(state.stubRuns).toBe(1);
  });
});
