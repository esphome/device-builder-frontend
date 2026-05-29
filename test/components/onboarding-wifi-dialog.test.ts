// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";

import { ESPHomeOnboardingWifiDialog } from "../../src/components/onboarding-wifi-dialog.js";

/**
 * Regression coverage for the WPA password-length gate (fixes #425).
 *
 * The bug was a boundary one: the dialog accepted passwords 1-7 chars
 * long, which no WPA/WPA2 device can associate to, while an empty
 * password is a legitimate open network. ``_passwordTooShort`` is the
 * single predicate behind the Save button's ``disabled`` state, the
 * inline error, and the ``_save`` guard, so pinning it across the
 * boundary locks the behavior in all three places at once.
 */

interface DialogPrivateView extends EventTarget {
  _ssid: string;
  _password: string;
  _api: { setOnboardingWifi: (ssid: string, password: string) => Promise<unknown> };
  readonly _passwordTooShort: boolean;
  _save(): Promise<void>;
}

function makeDialog(): DialogPrivateView {
  return new ESPHomeOnboardingWifiDialog() as unknown as DialogPrivateView;
}

describe("onboarding-wifi-dialog password-length gate", () => {
  test("empty password is allowed (open network)", () => {
    const dialog = makeDialog();
    dialog._password = "";
    expect(dialog._passwordTooShort).toBe(false);
  });

  test("1-7 char passwords are rejected", () => {
    const dialog = makeDialog();
    for (const pw of ["a", "1234567"]) {
      dialog._password = pw;
      expect(dialog._passwordTooShort).toBe(true);
    }
  });

  test("8-char password is the first accepted length", () => {
    const dialog = makeDialog();
    dialog._password = "1234567"; // 7 — rejected
    expect(dialog._passwordTooShort).toBe(true);
    dialog._password = "12345678"; // 8 — the WPA minimum, accepted
    expect(dialog._passwordTooShort).toBe(false);
  });

  test("whitespace counts toward the length (passphrases keep it)", () => {
    const dialog = makeDialog();
    dialog._password = "       "; // 7 spaces — still too short
    expect(dialog._passwordTooShort).toBe(true);
    dialog._password = "        "; // 8 spaces — accepted
    expect(dialog._passwordTooShort).toBe(false);
  });

  test("_save bails out before hitting the API on a too-short password", async () => {
    const dialog = makeDialog();
    const setOnboardingWifi = vi.fn().mockResolvedValue(undefined);
    dialog._api = { setOnboardingWifi };
    dialog._ssid = "MyNetwork";
    dialog._password = "1234567"; // 7 chars

    await dialog._save();

    expect(setOnboardingWifi).not.toHaveBeenCalled();
  });

  test("a second _save while one is in flight does not double-submit", async () => {
    const dialog = makeDialog();
    // Never resolves, so the first call stays in flight (``_saving`` true)
    // while the second runs — exactly the held-Enter window the EnterController
    // path opens by bypassing the disabled Save button.
    const setOnboardingWifi = vi.fn(() => new Promise<void>(() => {}));
    dialog._api = { setOnboardingWifi };
    dialog._ssid = "MyNetwork";
    dialog._password = "12345678";

    void dialog._save();
    await dialog._save();

    expect(setOnboardingWifi).toHaveBeenCalledTimes(1);
  });
});
