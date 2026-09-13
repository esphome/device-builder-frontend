// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from "vitest";

// The save-success path fires a toast; stub it so these unit tests
// don't need a rendered toaster container.
vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn(async () => true) }));
vi.mock("../../src/util/navigation.js", () => ({ navigate }));
beforeEach(() => navigate.mockClear());

import "../_mock-webawesome.js";

import { baseDialog, mount } from "../_dom.js";
import { APIError } from "../../src/api/api-error.js";
import { ErrorCode } from "../../src/api/types/protocol.js";
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
  _dialog: { open: boolean; onRequestClose(): void };
  _saving: boolean;
  _loadState: "loading" | "ready" | "failed" | "advanced";
  _error: string | null;
  _api: {
    setWifiCredentials?: (ssid: string, password: string) => Promise<unknown>;
    getConfig?: (configuration: string) => Promise<string>;
  };
  readonly _passwordTooShort: boolean;
  _enter: { set(active: boolean): void };
  _save(): Promise<void>;
  _loadStored(): Promise<void>;
  open(): void;
  close(): void;
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
    dialog._dialog.open = true; // past the dismissed-dialog guard, so the length gate is what bails
    const setWifiCredentials = vi.fn().mockResolvedValue(undefined);
    dialog._api = { setWifiCredentials };
    dialog._ssid = "MyNetwork";
    dialog._password = "1234567"; // 7 chars

    await dialog._save();

    expect(setWifiCredentials).not.toHaveBeenCalled();
  });

  test("a second _save while one is in flight does not double-submit", async () => {
    const dialog = makeDialog();
    // Never resolves, so the first call stays in flight (``_saving`` true)
    // while the second runs — exactly the held-Enter window the EnterController
    // path opens by bypassing the disabled Save button.
    const setWifiCredentials = vi.fn(() => new Promise<void>(() => {}));
    dialog._api = { setWifiCredentials };
    dialog._dialog.open = true;
    dialog._ssid = "MyNetwork";
    dialog._password = "12345678";

    void dialog._save();
    await dialog._save();

    expect(setWifiCredentials).toHaveBeenCalledTimes(1);
  });
});

/**
 * Regression coverage for the esphome-base-dialog migration (#546).
 *
 * The migration moved the save-in-flight close veto onto base-dialog's
 * ``?busy`` gate and replaced the imperative ``dialog.open`` with a
 * reactive open flag (owned by DialogOpenController), so the close /
 * error paths are the part most
 * likely to silently regress. These pin the contract the host still
 * owns: a failed save keeps the dialog open with an inline error, a
 * successful save closes it and fires ``secrets-saved``, and the reactive
 * close path flips the controller's open flag.
 */
describe("onboarding-wifi-dialog close / error gating", () => {
  test("a failed save shows the inline error and leaves the dialog open", async () => {
    const dialog = makeDialog();
    const setWifiCredentials = vi.fn().mockRejectedValue(new Error("write failed"));
    dialog._api = { setWifiCredentials };
    dialog._dialog.open = true;
    dialog._ssid = "MyNetwork";
    dialog._password = "12345678";

    await dialog._save();

    expect(dialog._error).toBeTruthy(); // inline error surfaced
    expect(dialog._dialog.open).toBe(true); // dialog stays open to retry
    expect(dialog._saving).toBe(false); // re-enabled for another attempt
  });

  test("a successful save closes the dialog and fires secrets-saved", async () => {
    const dialog = makeDialog();
    const setWifiCredentials = vi.fn().mockResolvedValue(undefined);
    dialog._api = { setWifiCredentials };
    dialog._dialog.open = true;
    dialog._ssid = "MyNetwork";
    dialog._password = "12345678";

    const saved = vi.fn();
    window.addEventListener("secrets-saved", saved);
    try {
      await dialog._save();
    } finally {
      window.removeEventListener("secrets-saved", saved);
    }

    expect(setWifiCredentials).toHaveBeenCalledWith("MyNetwork", "12345678");
    expect(dialog._dialog.open).toBe(false); // closed via the reactive flag
    expect(saved).toHaveBeenCalledTimes(1); // pickers + kebab wording refresh
  });
});

/** A dialog whose secrets.yaml read resolves to *yaml*. */
function dialogWithSecrets(yaml: string): DialogPrivateView {
  const dialog = makeDialog();
  dialog._api = { getConfig: vi.fn().mockResolvedValue(yaml) };
  return dialog;
}

describe("onboarding-wifi-dialog stored-credential prefill", () => {
  test("open seeds both fields from secrets.yaml", async () => {
    const dialog = dialogWithSecrets(
      'api_key: abc\nwifi_ssid: "My Net"\nwifi_password: "p\\"ss word"\n'
    );

    dialog.open();
    try {
      expect(dialog._loadState).toBe("loading"); // fields held until the read settles
      await vi.waitFor(() => expect(dialog._loadState).toBe("ready"));
    } finally {
      dialog._enter.set(false); // drop the window Enter listener open() bound
    }

    expect(dialog._api.getConfig).toHaveBeenCalledWith("secrets.yaml");
    expect(dialog._ssid).toBe("My Net");
    expect(dialog._password).toBe('p"ss word'); // double-quoted scalar unescaped
  });

  test("a dismiss while the read is in flight drops its result", async () => {
    const dialog = makeDialog();
    let resolveRead!: (yaml: string) => void;
    dialog._api = {
      getConfig: vi.fn(() => new Promise<string>((r) => (resolveRead = r))),
    };

    dialog.open();
    try {
      dialog.close(); // the request-close binding (Escape / X) routes here too
      resolveRead("wifi_ssid: late\nwifi_password: latepw\n");
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      dialog._enter.set(false);
    }

    expect(dialog._dialog.open).toBe(false);
    expect(dialog._ssid).toBe("");
    expect(dialog._password).toBe("");
  });

  test("Enter during the hide animation after a dismiss does not save the prefilled fields", async () => {
    const dialog = dialogWithSecrets("wifi_ssid: home\nwifi_password: hunter2pw\n");
    const setWifiCredentials = vi.fn().mockResolvedValue(undefined);
    dialog._api.setWifiCredentials = setWifiCredentials;

    dialog.open();
    try {
      await vi.waitFor(() => expect(dialog._loadState).toBe("ready"));
      dialog.close();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      await Promise.resolve();
    } finally {
      dialog._enter.set(false);
    }

    expect(setWifiCredentials).not.toHaveBeenCalled();
  });

  test("the request-close binding (Escape / X) drops the load and unbinds Enter", async () => {
    const dialog = dialogWithSecrets("wifi_ssid: home\nwifi_password: hunter2pw\n");
    const setWifiCredentials = vi.fn().mockResolvedValue(undefined);
    dialog._api.setWifiCredentials = setWifiCredentials;
    const el = dialog as unknown as HTMLElement;
    await mount(el);
    try {
      dialog.open();
      await vi.waitFor(() => expect(dialog._loadState).toBe("ready"));
      baseDialog(el).dispatchEvent(new CustomEvent("request-close"));
      expect(dialog._dialog.open).toBe(false);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      await Promise.resolve();
    } finally {
      dialog._enter.set(false);
      el.remove();
    }

    expect(setWifiCredentials).not.toHaveBeenCalled();
  });

  test("a reopen gets fresh field elements, so the reveal toggle starts hidden", async () => {
    const dialog = dialogWithSecrets("wifi_ssid: home\nwifi_password: hunter2pw\n");
    const el = dialog as unknown as HTMLElement;
    await mount(el);
    const passwordInput = () => el.shadowRoot!.querySelector("esphome-password-input");
    const settled = () =>
      (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    try {
      dialog.open();
      await vi.waitFor(() => expect(dialog._loadState).toBe("ready"));
      await settled();
      const first = passwordInput();
      expect(first).not.toBeNull();

      dialog.close();
      dialog.open();
      await vi.waitFor(() => expect(dialog._loadState).toBe("ready"));
      await settled();
      expect(passwordInput()).not.toBe(first);
      expect(dialog._password).toBe("hunter2pw");
    } finally {
      dialog._enter.set(false);
      el.remove();
    }
  });

  test("a missing secrets.yaml is the first-run blank form, not a read failure", async () => {
    const dialog = makeDialog();
    dialog._api = {
      getConfig: vi
        .fn()
        .mockRejectedValue(new APIError(ErrorCode.NOT_FOUND, "no such file")),
    };

    await dialog._loadStored();

    expect(dialog._loadState).toBe("ready");
    expect(dialog._error).toBeNull();
    expect(dialog._ssid).toBe("");
    expect(dialog._password).toBe("");
  });

  test("a duplicate key holds the form when its first line isn't inline-editable", async () => {
    const dialog = dialogWithSecrets(
      "wifi_ssid: home\nwifi_password: *pw\nwifi_password: plain\n"
    );

    await dialog._loadStored();

    expect(dialog._loadState).toBe("advanced"); // not "plain" via the second line
    expect(dialog._password).toBe("");
  });

  test("a value the form can't edit inline holds the form instead of prefilling its marker", async () => {
    const dialog = dialogWithSecrets(
      "common: &pw sharedpass\nwifi_ssid: home\nwifi_password: *pw\n"
    );

    await dialog._loadStored();

    expect(dialog._loadState).toBe("advanced");
    expect(dialog._error).toBe("onboarding.wifi.advanced_value"); // localize stub echoes the key
    expect(dialog._ssid).toBe(""); // held: neither field is editable, so no Save can clobber *pw
    expect(dialog._password).toBe("");
  });

  test("the advanced hold offers Open secrets, which navigates and closes", async () => {
    const dialog = dialogWithSecrets(
      "common: &pw x\nwifi_ssid: home\nwifi_password: *pw\n"
    );
    const el = dialog as unknown as HTMLElement;
    await mount(el);
    try {
      dialog.open();
      await vi.waitFor(() => expect(dialog._loadState).toBe("advanced"));
      await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
      const primary = el.shadowRoot!.querySelector<HTMLButtonElement>(".btn--primary")!;
      expect(primary.textContent!.trim()).toBe("wizard.open_secrets"); // localize stub echoes the key

      primary.click();
      await vi.waitFor(() => expect(dialog._dialog.open).toBe(false));
      expect(navigate).toHaveBeenCalledWith("/secrets");
    } finally {
      dialog._enter.set(false);
      el.remove();
    }
  });

  test("Enter on a held form runs the hold's action, never a save", async () => {
    const dialog = dialogWithSecrets(
      "common: &pw x\nwifi_ssid: home\nwifi_password: *pw\n"
    );
    const setWifiCredentials = vi.fn().mockResolvedValue(undefined);
    dialog._api.setWifiCredentials = setWifiCredentials;

    dialog.open();
    try {
      await vi.waitFor(() => expect(dialog._loadState).toBe("advanced"));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/secrets"));
    } finally {
      dialog._enter.set(false);
    }

    expect(setWifiCredentials).not.toHaveBeenCalled();
  });

  test("Enter on a held form does not save", async () => {
    const dialog = dialogWithSecrets(
      "common: &pw x\nwifi_ssid: home\nwifi_password: *pw\n"
    );
    const setWifiCredentials = vi.fn().mockResolvedValue(undefined);
    dialog._api.setWifiCredentials = setWifiCredentials;
    dialog._dialog.open = true;

    await dialog._loadStored();
    expect(dialog._loadState).toBe("advanced");
    await dialog._save(); // the Enter path calls this directly, bypassing the missing button

    expect(setWifiCredentials).not.toHaveBeenCalled();
  });

  test("a stored short password does not trip the length gate until it is edited", async () => {
    const dialog = dialogWithSecrets("wifi_ssid: home\nwifi_password: abc\n");

    await dialog._loadStored();

    expect(dialog._password).toBe("abc");
    expect(dialog._passwordTooShort).toBe(false); // SSID-only edit stays saveable
    dialog._password = "abcd";
    expect(dialog._passwordTooShort).toBe(true);
  });

  test("a missing key leaves that field blank", async () => {
    const dialog = dialogWithSecrets("wifi_ssid: home\n");

    await dialog._loadStored();

    expect(dialog._ssid).toBe("home");
    expect(dialog._password).toBe("");
  });

  test("a failed read surfaces an error and a retry instead of an empty editable form", async () => {
    const dialog = makeDialog();
    dialog._api = {
      getConfig: vi
        .fn()
        .mockRejectedValueOnce(new Error("backend unavailable"))
        .mockResolvedValueOnce("wifi_ssid: home\nwifi_password: hunter2pw\n"),
    };

    await dialog._loadStored();

    expect(dialog._loadState).toBe("failed"); // Save swapped for Retry, fields held
    expect(dialog._error).toBeTruthy();

    const retry = dialog._loadStored();
    expect(dialog._loadState).toBe("loading");
    expect(dialog._error).toBeTruthy(); // the retry keeps its error (and label) until it settles
    await retry;

    expect(dialog._error).toBeNull();
    expect(dialog._loadState).toBe("ready");
    expect(dialog._ssid).toBe("home");
    expect(dialog._password).toBe("hunter2pw");
  });

  test("a load superseded by a newer one does not apply its result", async () => {
    const dialog = makeDialog();
    let resolveFirst!: (yaml: string) => void;
    dialog._api = {
      getConfig: vi
        .fn()
        .mockImplementationOnce(() => new Promise<string>((r) => (resolveFirst = r)))
        .mockResolvedValueOnce("wifi_ssid: second\nwifi_password: secondpw\n"),
    };

    const first = dialog._loadStored();
    await dialog._loadStored();
    resolveFirst("wifi_ssid: first\nwifi_password: firstpw\n");
    await first;

    expect(dialog._ssid).toBe("second");
    expect(dialog._password).toBe("secondpw");
    expect(dialog._loadState).toBe("ready");
  });
});
