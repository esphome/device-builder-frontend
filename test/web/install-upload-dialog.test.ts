// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
// Fail the flash so the dialog enters its "error" (in-progress) state, where the
// setup <input> is unrendered — the scenario a retry used to throw in.
vi.mock("../../src/web/install/run-flash.js", () => ({
  runFlash: vi.fn(async (_port, _plan, hooks) => {
    hooks.onStep("error");
    hooks.onError("boom");
    return false;
  }),
}));

import { runFlash } from "../../src/web/install/run-flash.js";
import { ESPHomeWebInstallUploadDialog } from "../../src/web/install/esphome-web-install-upload-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function mount(): Promise<ESPHomeWebInstallUploadDialog> {
  const el = new ESPHomeWebInstallUploadDialog();
  (el as any)._localize = (k: string) => k;
  el.port = {} as SerialPort;
  el.open = true;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("esphome-web-install-upload-dialog", () => {
  it("keeps the picked file in state so a retry after a failed flash doesn't throw", async () => {
    const el = await mount();
    const file = new File([new Uint8Array([0xe9, 1, 2, 3])], "fw.bin");

    // Pick a file the way the <input>'s change handler does.
    (el as any)._onFileChange({ currentTarget: { files: [file] } } as unknown as Event);
    expect((el as any)._file).toBe(file);

    // First attempt fails → dialog is in the "error" phase, input unrendered.
    await (el as any)._install();
    expect(runFlash).toHaveBeenCalledTimes(1);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("input[type=file]")).toBeNull();

    // Retry reads _file (not a null @query input) — must not throw.
    await expect((el as any)._install()).resolves.toBeUndefined();
    expect(runFlash).toHaveBeenCalledTimes(2);
  });

  it("gives the file input an accessible name", async () => {
    const el = await mount();
    const input = el.shadowRoot!.querySelector("input[type=file]");
    expect(input?.getAttribute("aria-label")).toBeTruthy();
  });

  it("clears the picked file on close", async () => {
    const el = await mount();
    (el as any)._onFileChange({
      currentTarget: { files: [new File([new Uint8Array([0xe9])], "fw.bin")] },
    } as unknown as Event);
    expect((el as any)._file).toBeInstanceOf(File);

    (el as any)._onAfterHide();
    expect((el as any)._file).toBeUndefined();
  });
});
