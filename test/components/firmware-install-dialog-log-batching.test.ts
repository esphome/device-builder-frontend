/**
 * @vitest-environment happy-dom
 *
 * Pins the dialog-level batching wiring with a REAL LineBatcher (the flow
 * harnesses stub the sink): lines buffer until a flush point, and _fail /
 * _detachStream land the pending batch synchronously.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../src/util/web-serial.js", () => ({
  connectToPort: vi.fn(),
  detectChip: vi.fn(),
  disconnect: vi.fn(),
  flashFirmware: vi.fn(),
  resetAndDisconnect: vi.fn(),
  SERIAL_ACTIVITY_WINDOW_MS: 6000,
}));

import { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";
import { identityLocalize } from "../_dom.js";

function makeDialog(): ESPHomeFirmwareInstallDialog {
  const dialog = new ESPHomeFirmwareInstallDialog();
  Object.assign(dialog, { _localize: identityLocalize });
  return dialog;
}

describe("install-dialog log batching wiring", () => {
  it("buffers lines until the frame, and _fail lands them synchronously", () => {
    const dialog = makeDialog();
    dialog._enqueueLogLine("buffered line");
    // Still pending — the rAF hasn't fired.
    expect(dialog._logLines).toEqual([]);
    dialog._fail("boom");
    // The expanded error log must show every line, not race the rAF.
    expect(dialog._logLines).toEqual(["buffered line"]);
  });

  it("_detachStream lands the pending batch before teardown", () => {
    const dialog = makeDialog();
    dialog._enqueueLogLine("last line");
    dialog._detachStream();
    expect(dialog._logLines).toEqual(["last line"]);
  });
});
