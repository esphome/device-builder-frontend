/**
 * @vitest-environment happy-dom
 *
 * Pins the dismiss semantics: X / Escape / backdrop (after-hide, _onClose)
 * and the offload hand-off leave the compile running in the background
 * queue and say so, a programmatic _close never cancels, and the footer
 * Stop (_cancel) is the only path that cancels.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../_mock-webawesome.js";
vi.mock("../../../src/util/web-serial.js", () => ({
  connectToPort: vi.fn(),
  detectChip: vi.fn(),
  disconnect: vi.fn(),
  flashFirmware: vi.fn(),
  resetAndDisconnect: vi.fn(),
  SERIAL_ACTIVITY_WINDOW_MS: 6000,
}));
const { notifyInfo, notifyError } = vi.hoisted(() => ({
  notifyInfo: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock("../../../src/util/notify.js", () => ({
  LONG_TOAST_DURATION_MS: 8000,
  notifyInfo,
  notifyError,
  notify: { error: notifyError },
}));

import { deferred, identityLocalize } from "../../_dom.js";
import { ESPHomeFirmwareInstallDialog } from "../../../src/components/firmware-install-dialog.js";

const TOAST_KEY = "firmware.compile_continues_background";

function makeDialog() {
  const api = {
    firmwareCancel: vi.fn().mockResolvedValue(undefined),
    stopStream: vi.fn().mockResolvedValue(undefined),
  };
  const dialog = new ESPHomeFirmwareInstallDialog();
  const reject = vi.fn();
  Object.assign(dialog, {
    _localize: identityLocalize,
    _api: api,
    _step: "compiling",
    _jobId: "j1",
    _streamId: "s1",
    _compileReject: reject,
  });
  return { dialog, api, reject };
}

describe("install-dialog dismissal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("_onClose keeps the compile running and offers Firmware tasks", () => {
    const { dialog, api, reject } = makeDialog();
    dialog._onClose();
    expect(api.firmwareCancel).not.toHaveBeenCalled();
    expect(api.stopStream).toHaveBeenCalledWith("s1");
    expect(dialog._jobId).toBe("");
    expect(reject).toHaveBeenCalledTimes(1);
    expect(notifyInfo).toHaveBeenCalledWith(
      TOAST_KEY,
      expect.objectContaining({ id: expect.any(String), action: expect.any(Object) })
    );
    const opened = vi.fn();
    dialog.addEventListener("open-firmware-jobs", opened);
    notifyInfo.mock.calls[0][1].action.onClick();
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("_onClose without an attached compile stays silent", () => {
    const { dialog, api } = makeDialog();
    dialog._jobId = "";
    dialog._onClose();
    expect(api.firmwareCancel).not.toHaveBeenCalled();
    expect(notifyInfo).not.toHaveBeenCalled();
  });

  it("_onClose past the compile steps stays silent", () => {
    const { dialog } = makeDialog();
    dialog._step = "download-ready";
    dialog._onClose();
    expect(notifyInfo).not.toHaveBeenCalled();
  });

  it("_close never cancels", () => {
    const { dialog, api } = makeDialog();
    dialog._close();
    expect(api.firmwareCancel).not.toHaveBeenCalled();
    expect(dialog._jobId).toBe("");
  });

  it("the offload hand-off releases the compile with the same toast", () => {
    const { dialog, api } = makeDialog();
    dialog._tryOpenBuildOffloadSettings();
    expect(api.firmwareCancel).not.toHaveBeenCalled();
    expect(notifyInfo).toHaveBeenCalledTimes(1);
    expect(notifyInfo.mock.calls[0][0]).toBe(TOAST_KEY);
  });

  it("Stop cancels the compile exactly once", async () => {
    const { dialog, api } = makeDialog();
    await dialog._cancel();
    expect(api.firmwareCancel).toHaveBeenCalledTimes(1);
    expect(api.firmwareCancel).toHaveBeenCalledWith("j1");
    expect(dialog._jobId).toBe("");
    expect(notifyInfo).not.toHaveBeenCalled();
  });

  it("a failed Stop tells the user instead of closing quietly", async () => {
    const { dialog, api } = makeDialog();
    api.firmwareCancel.mockRejectedValue(new Error("boom"));
    await dialog._cancel();
    expect(notifyError).toHaveBeenCalledTimes(1);
  });

  it("a dismissal racing Stop's round-trip stays silent", async () => {
    const { dialog, api } = makeDialog();
    const cancel = deferred<void>();
    api.firmwareCancel.mockReturnValue(cancel.promise);
    const stopped = dialog._cancel();
    dialog._onClose();
    expect(notifyInfo).not.toHaveBeenCalled();
    cancel.resolve();
    await stopped;
    expect(api.firmwareCancel).toHaveBeenCalledTimes(1);
  });
});
