/**
 * @vitest-environment happy-dom
 *
 * A browser flasher is a descriptor the install dialog runs without knowing
 * the platform. A test-only flasher proves a new platform needs no dialog
 * edits: install, step copy, footer buttons, the step body, the logs toggle,
 * download-ready copy and both Retry paths all come from the descriptor.
 */
import { html } from "lit";
import { describe, expect, it, vi } from "vitest";

import "../../_mock-webawesome.js";

import { identityLocalize } from "../../_dom.js";
import { findTemplatesByAnchor, visitTemplates } from "../../_lit-template-walker.js";
import { PLATFORM_INSTALLS } from "../../_platform-installs.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { ESPHomeFirmwareInstallDialog } from "../../../src/components/firmware-install-dialog.js";
import {
  cardState,
  cardStatusDetail,
  cardStatusMessage,
  renderFooter,
  renderStatusExtra,
} from "../../../src/components/firmware-install-dialog/renderers.js";
import {
  type AnyBrowserInstall,
  type BrowserInstall,
  FlashImageSlot,
} from "../../../src/platforms/platform-support.js";

// tsc checks src and test as one program, so this widens FlasherId and
// InstallStep there too; the ids are test-only on purpose so a stray use in
// src stands out.
declare module "../../../src/platforms/platform-support.js" {
  interface BrowserFlasherSteps {
    "test-only-flash": "test-only-ready" | "test-only-wait";
  }
}

const device = { configuration: "fake.yaml", name: "fake" } as ConfiguredDevice;
const fakeImage = new FlashImageSlot<{ bytes: number }>();
const doReset = vi.fn();
const doFlash = vi.fn();

const fakeFlasher: BrowserInstall<"test-only-flash"> = {
  id: "test-only-flash",
  methodKey: "fake",
  holdsPort: true,
  image: fakeImage,
  start: vi.fn(async (host) => {
    fakeImage.set(host, { bytes: 1 });
    fakeFlasher.showFirstStep(host);
  }),
  showFirstStep: (host) => {
    host._step = "test-only-ready";
    host._statusMessage = "fake.ready_title";
  },
  steps: {
    "test-only-ready": {
      detailKey: "fake.ready_desc",
      footer: () => ({
        secondary: { run: doFlash, labelKey: "fake.flash" },
        primary: { run: doReset, labelKey: "fake.reset" },
      }),
    },
    "test-only-wait": {
      detailKey: () => "fake.wait_desc",
      extra: () => html`<span class="fake-extra"></span>`,
    },
  },
  downloadReady: { titleKey: "fake.saved_title", bodyKey: "fake.saved_body" },
};

function makeDialog(): ESPHomeFirmwareInstallDialog {
  const dialog = new ESPHomeFirmwareInstallDialog();
  Object.assign(dialog, {
    _localize: identityLocalize,
    _activeJobs: new Map(),
    _api: { stopStream: vi.fn() },
  });
  return dialog;
}

// A dialog mid-install with `flasher`, without running its start.
function dialogRunning(flasher: AnyBrowserInstall): ESPHomeFirmwareInstallDialog {
  const dialog = makeDialog();
  Object.assign(dialog, {
    _device: device,
    _open: true,
    _installer: flasher.id,
    _flasher: flasher,
  });
  return dialog;
}

function values(template: unknown): unknown[] {
  const out: unknown[] = [];
  visitTemplates(template as Parameters<typeof visitTemplates>[0], (t) =>
    out.push(...t.values)
  );
  return out;
}

describe("a browser flasher in the install dialog", () => {
  it("installs through the descriptor and lands on its first step", async () => {
    const dialog = makeDialog();
    dialog.installBrowserFlasher(fakeFlasher, device);
    await Promise.resolve();
    expect(fakeFlasher.start).toHaveBeenCalledWith(dialog);
    expect(dialog._installer).toBe("test-only-flash");
    expect(dialog._flasher).toBe(fakeFlasher);
    expect(dialog._step).toBe("test-only-ready");
    expect(cardState(dialog)).toBe("running");
    expect(cardStatusDetail(dialog)).toBe("fake.ready_desc");
  });

  it("runs the step's buttons with the dialog from the click", () => {
    const dialog = makeDialog();
    dialog.installBrowserFlasher(fakeFlasher, device);
    dialog._step = "test-only-ready";
    const clicks = values(renderFooter(dialog)).filter(
      (v): v is () => void =>
        typeof v === "function" && v !== dialog._close && v.length === 0
    );
    for (const click of clicks) click();
    expect(doReset).toHaveBeenCalledWith(dialog);
    expect(doFlash).toHaveBeenCalledWith(dialog);
  });

  it("uses a function detail, the step body, and keeps Stop with the logs toggle", () => {
    const dialog = makeDialog();
    dialog.installBrowserFlasher(fakeFlasher, device);
    dialog._step = "test-only-wait";
    expect(cardStatusDetail(dialog)).toBe("fake.wait_desc");
    expect(
      findTemplatesByAnchor(renderStatusExtra(dialog), 'class="fake-extra"')
    ).toHaveLength(1);
    const footer = values(renderFooter(dialog));
    expect(footer).toContain(dialog._cancel);
    expect(footer).toContain(dialog._toggleShowLogsAfterInstall);
  });

  it("uses the flasher's download-ready copy", () => {
    const dialog = makeDialog();
    dialog.installBrowserFlasher(fakeFlasher, device);
    dialog._step = "download-ready";
    expect(cardStatusMessage(dialog)).toBe("fake.saved_title");
    expect(cardStatusDetail(dialog)).toBe("fake.saved_body");
  });
});

describe("Retry for a browser flasher", () => {
  it.each([...PLATFORM_INSTALLS, fakeFlasher].map((f) => [f.id, f] as const))(
    "%s reinstalls when no image was parsed",
    async (_id, flasher) => {
      const dialog = dialogRunning(flasher);
      dialog._step = "error";
      const install = vi
        .spyOn(dialog, "installBrowserFlasher")
        .mockImplementation(() => {});
      await dialog._retry();
      expect(install).toHaveBeenCalledWith(flasher, device);
    }
  );

  it("reinstalls when the slot holds an image the flasher did not store", async () => {
    const dialog = dialogRunning(fakeFlasher);
    dialog._flashImage = { bytes: 1 };
    dialog._step = "error";
    const install = vi
      .spyOn(dialog, "installBrowserFlasher")
      .mockImplementation(() => {});
    await dialog._retry();
    expect(install).toHaveBeenCalledWith(fakeFlasher, device);
  });

  it.each([...PLATFORM_INSTALLS, fakeFlasher].map((f) => [f.id, f] as const))(
    "%s returns to its first step without recompiling while the image is kept",
    async (_id, flasher) => {
      const dialog = dialogRunning(flasher);
      flasher.image.set(dialog, {});
      dialog._step = "error";
      dialog._errorMessage = "failed";
      dialog._flashBusy = true;
      const install = vi.spyOn(dialog, "installBrowserFlasher");
      await dialog._retry();
      expect(install).not.toHaveBeenCalled();
      expect(Object.keys(flasher.steps)).toContain(dialog._step);
      expect(dialog._errorMessage).toBe("");
      expect(dialog._flashBusy).toBe(false);
    }
  );
});

describe("Show logs after an install that ended without a port", () => {
  it("picks the port through the flow, keeps it and hands it to the logs", async () => {
    const picked = {} as SerialPort;
    const flasher = {
      ...fakeFlasher,
      pickLogsPort: vi.fn(async () => picked),
    } as unknown as AnyBrowserInstall;
    const dialog = dialogRunning(flasher);
    dialog._step = "done";
    const handoff = vi.fn();
    dialog.addEventListener("request-show-logs-after-install", handoff);
    await dialog._showLogsAgain();
    expect(dialog._logsPort).toBe(picked);
    expect(handoff).toHaveBeenCalledOnce();
    expect((handoff.mock.calls[0][0] as CustomEvent).detail.webSerialPort).toBe(picked);
  });

  it("ignores a second click while the picker is open", async () => {
    let finish: (port: SerialPort | null) => void = () => {};
    const pickLogsPort = vi.fn(
      () => new Promise<SerialPort | null>((resolve) => (finish = resolve))
    );
    const flasher = { ...fakeFlasher, pickLogsPort } as unknown as AnyBrowserInstall;
    const dialog = dialogRunning(flasher);
    dialog._step = "done";
    const first = dialog._showLogsAgain();
    await dialog._showLogsAgain();
    expect(pickLogsPort).toHaveBeenCalledOnce();
    finish(null);
    await first;
  });

  it("drops a pick that lands after the dialog moved to another install", async () => {
    let finish: (port: SerialPort | null) => void = () => {};
    const flasher = {
      ...fakeFlasher,
      pickLogsPort: () => new Promise<SerialPort | null>((resolve) => (finish = resolve)),
    } as unknown as AnyBrowserInstall;
    const dialog = dialogRunning(flasher);
    dialog._step = "done";
    const handoff = vi.fn();
    dialog.addEventListener("request-show-logs-after-install", handoff);
    const click = dialog._showLogsAgain();
    dialog._device = { configuration: "other.yaml", name: "other" } as ConfiguredDevice;
    finish({} as SerialPort);
    await click;
    expect(dialog._logsPort).toBeNull();
    expect(handoff).not.toHaveBeenCalled();
  });

  it("does nothing when the pick is dismissed", async () => {
    const flasher = {
      ...fakeFlasher,
      pickLogsPort: vi.fn(async () => null),
    } as unknown as AnyBrowserInstall;
    const dialog = dialogRunning(flasher);
    dialog._step = "done";
    const handoff = vi.fn();
    dialog.addEventListener("request-show-logs-after-install", handoff);
    await dialog._showLogsAgain();
    expect(dialog._logsPort).toBeNull();
    expect(handoff).not.toHaveBeenCalled();
  });
});
