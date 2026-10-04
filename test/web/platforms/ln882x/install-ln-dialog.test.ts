// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("../../../../src/components/process-terminal/process-terminal.js", () => ({}));
vi.mock("../../../../src/components/install-details-log.js", () => ({}));

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  loadLn882xImage: vi.fn(),
  runLn882x: vi.fn(),
  warmLn882x: vi.fn(),
}));
vi.mock("../../../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../../src/platforms/ln882x/index.js", () => ({
  loadLn882xImage: mocks.loadLn882xImage,
  loadLn882xEngine: async () => ({}),
  warmLn882x: mocks.warmLn882x,
  runLn882x: mocks.runLn882x,
}));

import { pickerText, pickFile } from "../../_pick-file.js";
import { identityLocalize, mount } from "../../../_dom.js";
import { UF2_FAMILY_LN882H } from "../../../../src/platforms/ln882x/ln882x-image.js";
import { ESPHomeWebInstallLnDialog } from "../../../../src/web/platforms/ln882x/esphome-web-install-ln-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const IMAGE = { familyId: UF2_FAMILY_LN882H, board: "b", runs: [], totalBytes: 0 };
const PORT = { getInfo: () => ({}) } as unknown as SerialPort;
const uf2 = () => new File([new Uint8Array(8)], "firmware.uf2");

async function mountBare(): Promise<any> {
  return (await mount(new ESPHomeWebInstallLnDialog(), {
    _localize: identityLocalize,
    open: true,
  } as Partial<ESPHomeWebInstallLnDialog>)) as any;
}

async function mountDialog(): Promise<any> {
  const el = await mountBare();
  await pickFile(el, "_image", uf2());
  return el;
}

const card = (el: any) => el.shadowRoot!.querySelector("esphome-process-terminal") as any;
const guide = (el: any) => el.shadowRoot!.querySelector(".guide a") as HTMLAnchorElement;

beforeEach(() => {
  mocks.loadLn882xImage.mockResolvedValue({ image: IMAGE });
  mocks.requestSerialPort.mockResolvedValue(PORT);
  mocks.runLn882x.mockResolvedValue({ rebooted: true });
  mocks.warmLn882x.mockResolvedValue({});
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("esphome-web-install-ln-dialog", () => {
  it("is titled and worded for the LN882H", async () => {
    const el = await mountDialog();

    expect(el.shadowRoot!.querySelector("esphome-base-dialog").label).toBe(
      "web.ln.install_title"
    );
    expect(el.shadowRoot!.textContent).toContain("web.ln.install_intro");
    // The engine and its RAM code start loading once the file parses.
    expect(mocks.warmLn882x).toHaveBeenCalledOnce();
  });

  it("asks for a reset by hand when the chip did not confirm its reboot", async () => {
    mocks.runLn882x.mockResolvedValue({ rebooted: false });
    const el = await mountDialog();

    await el._flash();
    await el.updateComplete;

    expect(card(el).statusMessage).toContain("firmware.ln_done_manual_reset");
  });

  it("flashes the parsed UF2 on the picked port and says the device is starting", async () => {
    const el = await mountDialog();

    await el._flash();
    await el.updateComplete;

    expect(mocks.runLn882x).toHaveBeenCalledWith(PORT, IMAGE, expect.any(Object));
    expect(card(el).state).toBe("success");
    expect(card(el).statusMessage).toBe("firmware.status_done web.ln.logs_elsewhere");
  });

  it("shows the BOOT guide while the engine waits for the chip", async () => {
    let finish!: () => void;
    mocks.runLn882x.mockImplementation(async (_port, _image, hooks) => {
      hooks.onWaiting();
      await new Promise<void>((resolve) => (finish = resolve));
      return { rebooted: true };
    });
    const el = await mountDialog();

    const flashing = el._flash();
    await vi.waitFor(() => expect(el._state).toBe("waiting"));
    await el.updateComplete;

    expect(card(el).statusMessage).toBe("firmware.ln_wait_title");
    expect(guide(el).href).toBe("https://docs.libretiny.eu/link/flashing-ln882h");
    expect(guide(el).textContent).toBe("firmware.ln_guide_link");
    finish();
    await flashing;
  });

  it.each([
    ["firmware.ln_ramcode_unavailable", "firmware.ln_ramcode_unavailable"],
    ["firmware.ln_ramcode_mismatch", "firmware.ln_ramcode_mismatch"],
    [undefined, "firmware.ln_flash_failed"],
  ])("names a failure by its own copy (%s)", async (key, title) => {
    mocks.runLn882x.mockResolvedValue({ detail: "why", error: new Error("why"), key });
    const el = await mountDialog();

    await el._flash();
    await el.updateComplete;

    expect(card(el).state).toBe("error");
    expect(card(el).statusMessage).toBe(title);
  });

  it("names a build for a chip that is not the LN882H's under the picker", async () => {
    mocks.loadLn882xImage.mockResolvedValue({
      key: "firmware.ln_wrong_family",
      detail: "family 0xe08f7564",
    });
    const el = await mountBare();

    await pickFile(el, "_image", uf2());

    expect(pickerText(el).error).toBe("firmware.ln_wrong_family: family 0xe08f7564");
    expect(mocks.runLn882x).not.toHaveBeenCalled();
  });
});
