/**
 * @vitest-environment happy-dom
 *
 * Pins the dialog-level batching wiring with a REAL LogBuffer (the flow
 * harnesses stub the sink): lines buffer until a flush point, and _fail /
 * _detachStream land the pending batch synchronously.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../src/util/web-serial.js", () => ({}));
vi.mock("../../src/platforms/esp/esptool.js", () => ({
  connectToPort: vi.fn(),
  detectChip: vi.fn(),
  disconnect: vi.fn(),
  flashFirmware: vi.fn(),
  resetAndDisconnect: vi.fn(),
}));
const { downloadAnsiText } = vi.hoisted(() => ({ downloadAnsiText: vi.fn() }));
vi.mock("../../src/util/download-text.js", () => ({
  configurationStem: vi.fn(() => "device"),
  downloadAnsiText,
  triggerDownload: vi.fn(),
}));

import { identityLocalize, renderInto } from "../_dom.js";
import { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";
import { renderLogs } from "../../src/components/firmware-install-dialog/renderers.js";

function makeDialog(): ESPHomeFirmwareInstallDialog {
  const dialog = new ESPHomeFirmwareInstallDialog();
  Object.assign(dialog, { _localize: identityLocalize });
  return dialog;
}

describe("install-dialog log batching wiring", () => {
  it("buffers lines until the frame, and _fail lands them synchronously", () => {
    const dialog = makeDialog();
    dialog._log.enqueue("buffered line");
    // Still pending — the rAF hasn't fired.
    expect(dialog._log.lines).toEqual([]);
    dialog._fail("boom");
    // The expanded error log must show every line, not race the rAF.
    expect(dialog._log.lines).toEqual(["buffered line"]);
  });

  it("_detachStream lands the pending batch before teardown", () => {
    const dialog = makeDialog();
    dialog._log.enqueue("last line");
    dialog._detachStream();
    expect(dialog._log.lines).toEqual(["last line"]);
  });

  it("a mid-stream log download flushes before reading", () => {
    const dialog = makeDialog();
    dialog._log.append(["landed line"]);
    dialog._log.enqueue("buffered line");
    const container = renderInto(renderLogs(dialog));
    // The dialog takes the download over from the log element so it can flush first.
    container
      .querySelector("esphome-install-details-log")!
      .dispatchEvent(new Event("download-log", { cancelable: true }));
    expect(downloadAnsiText).toHaveBeenCalledTimes(1);
    expect(downloadAnsiText).toHaveBeenCalledWith(
      ["landed line", "buffered line"],
      "device-install.txt"
    );
  });
});
