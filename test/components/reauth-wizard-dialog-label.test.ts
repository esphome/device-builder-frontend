/**
 * @vitest-environment happy-dom
 *
 * Pins that the re-pair request introduces this dashboard with the same
 * resolved self-label the fresh-pair dialog prefills (``offloaderSelfLabel``
 * over ``serverInfo``), while the OOB-verified pin still binds the request.
 */
import { describe, expect, it, vi } from "vitest";
import type { OffloaderPinMismatchAlert } from "../../src/api/types/remote-build-events.js";
import { ESPHomeReauthWizardDialog } from "../../src/components/reauth-wizard-dialog.js";

const alert: OffloaderPinMismatchAlert = {
  kind: "pin_mismatch",
  receiver_hostname: "buildbox.local",
  receiver_port: 6055,
  pin_sha256: "a".repeat(64),
  receiver_label: "buildbox",
  expected_pin: "a".repeat(64),
  observed_pin: "b".repeat(64),
  fired_at: 1,
};

describe("reauth re-pair offloader label", () => {
  it("sources the sent label from serverInfo via offloaderSelfLabel", async () => {
    const d = new ESPHomeReauthWizardDialog();
    const requestRemoteBuildPair = vi.fn(async (..._args: unknown[]) => ({
      pin_sha256: alert.observed_pin,
    }));
    Object.assign(d as unknown as Record<string, unknown>, {
      _api: {
        serverInfo: { friendly_name: "a1b2c3d4-esphome", ha_addon: true },
        requestRemoteBuildPair,
      },
      _alert: alert,
      _verified: true,
    });
    await (d as unknown as { _onConfirm: () => Promise<void> })._onConfirm();
    expect(requestRemoteBuildPair).toHaveBeenCalledOnce();
    const args = requestRemoteBuildPair.mock.calls[0][0] as unknown as {
      offloader_label: string;
      pin_sha256: string;
    };
    expect(args.offloader_label).toBe("Home Assistant App");
    // The security contract rides along untouched.
    expect(args.pin_sha256).toBe(alert.observed_pin);
  });
});
