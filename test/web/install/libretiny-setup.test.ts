// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("../../../src/components/process-terminal/process-terminal.js", () => ({}));
vi.mock("../../../src/components/install-details-log.js", () => ({}));

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  fetchEsphomeWebManifest: vi.fn(),
}));
vi.mock("../../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../src/web/util/esphome-web-firmware.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchEsphomeWebManifest: mocks.fetchEsphomeWebManifest,
}));

import { pickerText } from "../_pick-file.js";
import type { LibreTinyInstall } from "../../../src/web/install/esphome-web-libretiny-install-dialog.js";
import { resetEsphomeWebManifest } from "../../../src/web/util/esphome-web-firmware.js";
import {
  installButton,
  manifest,
  mountInstall,
  mountPrebuilt,
  pickUf2,
  radios,
  stubUf2Download,
  uf2,
} from "../platforms/_libretiny-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// What the dialog does for any family, the published image's or the user's own.
const PUBLISHED = { from: "published" };
const OWN = { from: "own file" };
const PORT = { getInfo: () => ({}) } as unknown as SerialPort;

const run = vi.fn();
const INSTALL: LibreTinyInstall<unknown> = {
  copy: {
    title: "title",
    intro: "intro",
    connecting: "connecting",
    connectDetail: "connect_detail",
    waiting: "waiting",
    waitDetail: "wait_detail",
    guideLink: "guide_link",
    done: "done",
    failed: "failed",
    badFile: "bad_file",
  },
  guideUrl: "https://example.com/guide",
  loadEngine: async () => ({}),
  // The published image downloads as the byte 1.
  load: async (bytes) => ({ image: bytes[0] === 1 ? PUBLISHED : OWN }),
  run,
  prebuilt: { families: ["LN882H"] },
};

const mountWith = (...families: string[]) =>
  mountPrebuilt(INSTALL, mocks.fetchEsphomeWebManifest, ...families);
const text = (el: any) => el.shadowRoot!.textContent ?? "";

let fetch: ReturnType<typeof stubUf2Download>;

beforeEach(() => {
  fetch = stubUf2Download(new Uint8Array([1]));
  mocks.requestSerialPort.mockResolvedValue(PORT);
  mocks.fetchEsphomeWebManifest.mockResolvedValue(manifest());
  run.mockResolvedValue({ rebooted: true });
});

afterEach(() => {
  resetEsphomeWebManifest();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("esphome-web-libretiny-install-dialog's setup", () => {
  it.each([
    [
      "cannot be read",
      () => mocks.fetchEsphomeWebManifest.mockRejectedValue(new Error("x")),
    ],
    ["publishes no image for the family", () => {}],
  ])("offers only the user's own file when the manifest %s", async (_n, given) => {
    given();
    const el = await mountInstall(INSTALL);
    await pickUf2(el, uf2());

    expect(radios(el, "mode")).toEqual([]);
    expect(text(el)).toContain("intro");
    await el._flash();
    expect(run).toHaveBeenCalledWith(PORT, OWN, expect.any(Object));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("offers the published firmware first, prepared before the click", async () => {
    const el = await mountWith("LN882H");

    expect(radios(el, "mode").map((r) => [r.value, r.checked])).toEqual([
      ["prebuilt", true],
      ["file", false],
    ]);
    expect(text(el)).toContain("web.install.prebuilt_intro");
    expect(el.shadowRoot!.querySelector("input[type=file]")).toBeNull();

    await el._flash();
    expect(run).toHaveBeenCalledWith(PORT, PUBLISHED, expect.any(Object));
  });

  it("installs the user's own file as before once they choose it", async () => {
    const el = await mountWith("LN882H");

    radios(el, "mode")[1].click();
    await el.updateComplete;
    expect(text(el)).toContain("web.install.uf2_intro");
    expect(installButton(el).hasAttribute("disabled")).toBe(true);
    await pickUf2(el, uf2());
    await el._flash();

    expect(run).toHaveBeenCalledWith(PORT, OWN, expect.any(Object));
  });

  it("keeps a file picked while the manifest was loading", async () => {
    let publish!: (m: unknown) => void;
    mocks.fetchEsphomeWebManifest.mockReturnValue(new Promise((r) => (publish = r)));
    const el = await mountInstall(INSTALL);
    await pickUf2(el, uf2());

    publish(manifest("LN882H"));
    await vi.waitFor(() => expect(el._setup.families).toEqual(["LN882H"]));
    await el.updateComplete;

    expect(radios(el, "mode")[1].checked).toBe(true);
    expect(pickerText(el).name).toBe("firmware.uf2");
    await el._flash();
    expect(run).toHaveBeenCalledWith(PORT, OWN, expect.any(Object));
  });

  it("names a failed download and downloads it again on Retry", async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 503 } as any);
    mocks.fetchEsphomeWebManifest.mockResolvedValue(manifest("LN882H"));
    const el = await mountInstall(INSTALL);
    await vi.waitFor(() => expect(el._setup.image.state.kind).toBe("retryable"));
    await el.updateComplete;

    expect(pickerText(el).error).toMatch(
      /^web\.install\.prebuilt_download_failed: .*failed \(503\)$/
    );
    installButton(el).click();
    await vi.waitFor(() => expect(el._setup.image.state.kind).toBe("ready"));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reads the manifest again on reopen without downloading the image again", async () => {
    const el = await mountWith("LN882H");

    el.open = false;
    await el.updateComplete;
    // The reset in that update renders once more.
    await el.updateComplete;
    expect(el._setup.families).toEqual([]);
    expect(radios(el, "mode")).toEqual([]);

    el.open = true;
    await vi.waitFor(() => expect(el._setup.image.state.kind).toBe("ready"));
    expect(mocks.fetchEsphomeWebManifest).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
