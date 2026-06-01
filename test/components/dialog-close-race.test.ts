/**
 * @vitest-environment happy-dom
 *
 * All three process dialogs stream output on a live subscription, so a
 * re-render with ?open=true during the hide animation can cancel the close.
 * Each guards it with a request-close handler that flips _open to false
 * immediately (teardown stays in after-hide). Pin that guard so a future
 * refactor can't quietly drop it.
 */
import { describe, expect, it } from "vitest";
import { ESPHomeCommandDialog } from "../../src/components/command-dialog.js";
import { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";
import { ESPHomeLogsDialog } from "../../src/components/logs-dialog.js";

describe("dialog close-animation race guards", () => {
  it("command dialog flips _open false on request-close", () => {
    const el = new ESPHomeCommandDialog() as unknown as {
      _open: boolean;
      _onDialogRequestClose: () => void;
    };
    el._open = true;
    el._onDialogRequestClose();
    expect(el._open).toBe(false);
  });

  it("firmware install dialog flips _open false on request-close", () => {
    const el = new ESPHomeFirmwareInstallDialog() as unknown as {
      _open: boolean;
      _onRequestClose: () => void;
    };
    el._open = true;
    el._onRequestClose();
    expect(el._open).toBe(false);
  });

  it("logs dialog flips _open false on request-close", () => {
    const el = new ESPHomeLogsDialog() as unknown as {
      _open: boolean;
      _onDialogRequestClose: () => void;
    };
    el._open = true;
    el._onDialogRequestClose();
    expect(el._open).toBe(false);
  });
});
