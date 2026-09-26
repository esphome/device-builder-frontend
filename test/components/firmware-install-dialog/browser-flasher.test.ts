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

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { identityLocalize } from "../../_dom.js";
import { findTemplatesByAnchor, visitTemplates } from "../../_lit-template-walker.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { ESPHomeFirmwareInstallDialog } from "../../../src/components/firmware-install-dialog.js";
import {
  type AnyBrowserFlasher,
  type BrowserFlasher,
  FlashImageSlot,
} from "../../../src/components/firmware-install-dialog/browser-flasher.js";
import {
  cardState,
  cardStatusDetail,
  cardStatusMessage,
  renderFooter,
  renderStatusExtra,
} from "../../../src/components/firmware-install-dialog/renderers.js";
import { BROWSER_FLASHERS } from "../../../src/platforms/browser-flashers.js";

declare module "../../../src/components/firmware-install-dialog/types.js" {
  interface BrowserFlasherSteps {
    "fake-flash": "fake-ready" | "fake-wait";
  }
}

const device = { configuration: "fake.yaml", name: "fake" } as ConfiguredDevice;
const fakeImage = new FlashImageSlot<{ bytes: number }>();
const doReset = vi.fn();
const doFlash = vi.fn();

const fakeFlasher: BrowserFlasher<"fake-flash"> = {
  id: "fake-flash",
  matches: (p) => p === "fake",
  methodKey: "fake",
  holdsPort: true,
  start: vi.fn(async (host) => {
    fakeImage.set(host, { bytes: 1 });
    fakeFlasher.showFirstStep(host);
  }),
  showFirstStep: (host) => {
    host._step = "fake-ready";
    host._statusMessage = "fake.ready_title";
  },
  steps: {
    "fake-ready": {
      detailKey: "fake.ready_desc",
      footer: () => ({
        secondary: { run: doFlash, labelKey: "fake.flash" },
        primary: { run: doReset, labelKey: "fake.reset" },
      }),
    },
    "fake-wait": {
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
function dialogRunning(flasher: AnyBrowserFlasher): ESPHomeFirmwareInstallDialog {
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
    expect(dialog._installer).toBe("fake-flash");
    expect(dialog._flasher).toBe(fakeFlasher);
    expect(dialog._step).toBe("fake-ready");
    expect(cardState(dialog)).toBe("running");
    expect(cardStatusDetail(dialog)).toBe("fake.ready_desc");
  });

  it("runs the step's buttons with the dialog from the click", () => {
    const dialog = makeDialog();
    dialog.installBrowserFlasher(fakeFlasher, device);
    dialog._step = "fake-ready";
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
    dialog._step = "fake-wait";
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
  it.each([...BROWSER_FLASHERS, fakeFlasher].map((f) => [f.id, f] as const))(
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

  it.each([...BROWSER_FLASHERS, fakeFlasher].map((f) => [f.id, f] as const))(
    "%s returns to its first step without recompiling while the image is kept",
    async (_id, flasher) => {
      const dialog = dialogRunning(flasher);
      dialog._flashImage = {};
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
