/**
 * Tests for ``onConfirmSubmit`` request args. Pins that the optional pairing
 * key is trimmed and forwarded only when non-empty (a blank field omits the
 * ``pairing_key`` arg entirely so a normal dashboard pair is unaffected), and
 * that the fixed args (host, port, pin, labels) always ride along.
 */
import { describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { ESPHomePairBuildServerDialog } from "../../../src/components/pair-build-server-dialog.js";
import { onConfirmSubmit } from "../../../src/components/pair-build-server-dialog/actions.js";
import { identityLocalize } from "../../_dom.js";

type RequestArgs = Parameters<ESPHomeAPI["requestRemoteBuildPair"]>[0];

function makeHost(pairingKey: string): {
  host: ESPHomePairBuildServerDialog;
  request: ReturnType<typeof vi.fn>;
} {
  const request = vi.fn(async () => ({ pin_sha256: "abc123", status: "pending" }));
  const host = {
    _localize: identityLocalize,
    _api: { requestRemoteBuildPair: request },
    _busy: false,
    _sending: false,
    _hostname: "buildbox.local",
    _port: "6055",
    _previewedPin: "abc123",
    _receiverLabel: "buildbox",
    _offloaderLabel: "ha-green",
    _pairingKey: pairingKey,
    _pairingKeyRequired: false,
    _offloaderLabelTouched: false,
    _error: null,
    _step: "confirm",
    _sentKey: null,
    dispatchEvent: () => true,
  } as unknown as ESPHomePairBuildServerDialog;
  return { host, request };
}

describe("onConfirmSubmit", () => {
  it("forwards a trimmed pairing key when one is entered", async () => {
    const { host, request } = makeHost("  ABCD-EFGH-JKMN-PQRS  ");
    await onConfirmSubmit(host);

    const args = request.mock.calls[0][0] as RequestArgs;
    expect(args.pairing_key).toBe("ABCD-EFGH-JKMN-PQRS");
    expect(args).toMatchObject({
      hostname: "buildbox.local",
      port: 6055,
      pin_sha256: "abc123",
      receiver_label: "buildbox",
      offloader_label: "ha-green",
    });
    expect(host._step).toBe("sent");
  });

  it("marks an untouched offloader label as auto-derived", async () => {
    const { host, request } = makeHost("");
    await onConfirmSubmit(host);

    const args = request.mock.calls[0][0] as RequestArgs;
    expect(args.offloader_label_auto).toBe(true);
  });

  it("marks a user-edited offloader label as not auto-derived", async () => {
    const { host, request } = makeHost("");
    (host as unknown as { _offloaderLabelTouched: boolean })._offloaderLabelTouched =
      true;
    await onConfirmSubmit(host);

    const args = request.mock.calls[0][0] as RequestArgs;
    expect(args.offloader_label_auto).toBe(false);
  });

  it("omits the pairing_key arg entirely when the field is blank", async () => {
    const { host, request } = makeHost("   ");
    await onConfirmSubmit(host);

    const args = request.mock.calls[0][0] as RequestArgs;
    expect(Object.prototype.hasOwnProperty.call(args, "pairing_key")).toBe(false);
  });

  it("blocks submit (e.g. via Enter) when a required key is empty", async () => {
    const { host, request } = makeHost("   ");
    host._pairingKeyRequired = true;
    await onConfirmSubmit(host);

    expect(request).not.toHaveBeenCalled();
    expect(host._error).toBe("settings.pair_build_server_pairing_key_required");
  });
});
