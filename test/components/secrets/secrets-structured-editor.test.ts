// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";

// wa-dialog / wa-button run form-validation lifecycle hooks happy-dom doesn't
// implement; stub them so the add-secret dialog can render in the test.
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));

import { ESPHomeSecretsStructuredEditor } from "../../../src/components/secrets/secrets-structured-editor.js";

interface DeviceStub {
  name: string;
  configuration: string;
  friendly_name: string;
}

async function mount(
  value: string,
  reveal = false,
  devices: DeviceStub[] = []
): Promise<ESPHomeSecretsStructuredEditor> {
  const el = new ESPHomeSecretsStructuredEditor();
  el.value = value;
  el.revealSensitive = reveal;
  (el as unknown as { _devices: DeviceStub[] })._devices = devices;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function rows(el: ESPHomeSecretsStructuredEditor): HTMLDivElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll<HTMLDivElement>(".row"));
}

function rowInputs(row: HTMLDivElement): HTMLInputElement[] {
  return Array.from(row.querySelectorAll("input"));
}

/** Capture the next yaml-change value, or null if none fires. */
function onChange(el: ESPHomeSecretsStructuredEditor): { value: string | null } {
  const captured = { value: null as string | null };
  el.addEventListener("yaml-change", (e) => {
    captured.value = (e as CustomEvent<{ value: string }>).detail.value;
  });
  return captured;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("esphome-secrets-structured-editor", () => {
  test("renders one row per top-level scalar entry", async () => {
    const el = await mount("wifi_ssid: home\nwifi_password: hunter2\n");
    expect(rows(el)).toHaveLength(2);
  });

  test("empty buffer shows the empty state and the add button", async () => {
    const el = await mount("");
    expect(rows(el)).toHaveLength(0);
    expect(el.shadowRoot!.querySelector(".empty")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".add-btn")).not.toBeNull();
  });

  test("the value field is a password input whose reveal follows the prop", async () => {
    const masked = await mount("wifi_ssid: home\n");
    const maskedPw = rows(masked)[0].querySelector("esphome-password-input");
    expect((maskedPw as unknown as { revealed: boolean }).revealed).toBe(false);

    const revealed = await mount("wifi_ssid: home\n", true);
    const revealedPw = rows(revealed)[0].querySelector("esphome-password-input");
    expect((revealedPw as unknown as { revealed: boolean }).revealed).toBe(true);
  });

  test("the value field's per-row eye hides while the page reveals all", async () => {
    const masked = await mount("wifi_ssid: home\n");
    expect(
      rows(masked)[0]
        .querySelector("esphome-password-input")!
        .shadowRoot!.querySelector(".toggle")
    ).not.toBeNull();

    const revealed = await mount("wifi_ssid: home\n", true);
    expect(
      rows(revealed)[0]
        .querySelector("esphome-password-input")!
        .shadowRoot!.querySelector(".toggle")
    ).toBeNull();
  });

  test("editing a value emits yaml-change with the spliced buffer", async () => {
    const el = await mount("wifi_ssid: home\n");
    const captured = onChange(el);
    const pw = rows(el)[0].querySelector("esphome-password-input")!;
    pw.dispatchEvent(
      new CustomEvent("password-input-change", { detail: { value: "office" } })
    );
    expect(captured.value).toBe("wifi_ssid: office\n");
  });

  test("removing a row emits yaml-change without that entry", async () => {
    const el = await mount("wifi_ssid: home\napi_key: abc\n");
    const captured = onChange(el);
    rows(el)[0].querySelector<HTMLButtonElement>(".icon-btn")!.click();
    expect(captured.value).toBe("api_key: abc\n");
  });

  interface AddView {
    _openAdd(): void;
    _confirmAdd(): void;
    _addTarget: string;
    _addName: string;
    _addValue: string;
    _addError: string | null;
    _addOpen: boolean;
  }

  test("Add secret opens the dialog and writes name: value only on confirm", async () => {
    const el = await mount("wifi_ssid: home\n");
    const captured = onChange(el);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".add-btn")!.click();
    await el.updateComplete;
    // The dialog is open and nothing has been written yet.
    expect(captured.value).toBeNull();
    const view = el as unknown as AddView;
    view._addName = "api_key";
    view._addValue = "abc";
    el.shadowRoot!.querySelector<HTMLButtonElement>(".btn--add")!.click();
    expect(captured.value).toBe("wifi_ssid: home\napi_key: abc\n");
  });

  test("a device target prefixes the new secret with <device>__", async () => {
    const el = await mount("wifi_ssid: home\n", false, [
      { name: "bw15", configuration: "bw15.yaml", friendly_name: "BW15" },
    ]);
    const captured = onChange(el);
    const view = el as unknown as AddView;
    view._openAdd();
    view._addTarget = "bw15";
    view._addName = "api";
    view._addValue = "xyz";
    view._confirmAdd();
    expect(view._addOpen).toBe(false);
    expect(captured.value).toBe("wifi_ssid: home\nbw15__api: xyz\n");
  });

  test("the add dialog rejects an invalid name and stays open", async () => {
    const el = await mount("wifi_ssid: home\n");
    const captured = onChange(el);
    const view = el as unknown as AddView;
    view._openAdd();
    view._addName = "1bad";
    view._confirmAdd();
    expect(captured.value).toBeNull();
    expect(view._addOpen).toBe(true);
    expect(view._addError).not.toBeNull();
  });

  test("the add dialog rejects a duplicate name", async () => {
    const el = await mount("wifi_ssid: home\n");
    const captured = onChange(el);
    const view = el as unknown as AddView;
    view._openAdd();
    view._addName = "wifi_ssid";
    view._confirmAdd();
    expect(captured.value).toBeNull();
    expect(view._addOpen).toBe(true);
  });

  test("a tagged value renders read-only with no value input", async () => {
    const el = await mount("ssid: !secret real_ssid\n");
    const row = rows(el)[0];
    expect(row.classList.contains("row--advanced")).toBe(true);
    const inputs = rowInputs(row);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].hasAttribute("readonly")).toBe(true);
    expect(row.querySelector(".icon-btn")).toBeNull();
  });

  test("renaming a key to a duplicate is blocked and surfaces an error", async () => {
    const el = await mount("wifi_ssid: home\napi_key: abc\n");
    const captured = onChange(el);
    const keyInput = rowInputs(rows(el)[1])[0];
    keyInput.value = "wifi_ssid";
    keyInput.dispatchEvent(new Event("change"));
    expect(captured.value).toBeNull();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".key-error")).not.toBeNull();
    expect(keyInput.value).toBe("api_key");
  });

  test("renaming a key to an invalid identifier is blocked", async () => {
    const el = await mount("wifi_ssid: home\n");
    const captured = onChange(el);
    const keyInput = rowInputs(rows(el)[0])[0];
    keyInput.value = "1nope";
    keyInput.dispatchEvent(new Event("change"));
    expect(captured.value).toBeNull();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".key-error")).not.toBeNull();
  });

  test("renaming a key to a valid new name emits the rename", async () => {
    const el = await mount("wifi_ssid: home\n");
    const captured = onChange(el);
    const keyInput = rowInputs(rows(el)[0])[0];
    keyInput.value = "ap_ssid";
    keyInput.dispatchEvent(new Event("change"));
    expect(captured.value).toBe("ap_ssid: home\n");
  });

  test("a structural edit clears a stale key error so it can't misattribute", async () => {
    const el = await mount("wifi_ssid: home\napi_key: abc\n");
    // Reject a rename on the second row, surfacing the error banner.
    const keyInput = rowInputs(rows(el)[1])[0];
    keyInput.value = "wifi_ssid";
    keyInput.dispatchEvent(new Event("change"));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".key-error")).not.toBeNull();
    // Removing a row shifts indices; the stale error must clear.
    rows(el)[0].querySelector<HTMLButtonElement>(".icon-btn")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".key-error")).toBeNull();
  });

  test("device-prefixed keys render under group headers", async () => {
    const el = await mount("wifi_ssid: home\nbw15__api: a\nbw15__ota: b\n");
    const headers = Array.from(
      el.shadowRoot!.querySelectorAll(".group-header"),
      (h) => h.textContent
    );
    expect(headers).toContain("bw15");
    expect(rows(el)).toHaveLength(3);
  });

  test("a flat shared file shows no group headers", async () => {
    const el = await mount("wifi_ssid: home\nwifi_password: x\n");
    expect(el.shadowRoot!.querySelectorAll(".group-header")).toHaveLength(0);
  });

  test("a group header links to the device editor when the device exists", async () => {
    const el = await mount("bw15__api: a\n", false, [
      { name: "bw15", configuration: "bw15.yaml", friendly_name: "BW15" },
    ]);
    const link = el.shadowRoot!.querySelector<HTMLAnchorElement>(".group-link");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/device/bw15.yaml");
  });

  test("a group header is plain text when no matching device exists", async () => {
    const el = await mount("bw15__api: a\n");
    expect(el.shadowRoot!.querySelector(".group-link")).toBeNull();
    expect(el.shadowRoot!.querySelector(".group-header")!.textContent).toContain("bw15");
  });

  test("links a hyphenated device whose secret prefix uses underscores", async () => {
    const el = await mount("apollo_r_pro__key: a\n", false, [
      { name: "apollo-r-pro", configuration: "apollo.yaml", friendly_name: "Apollo" },
    ]);
    const link = el.shadowRoot!.querySelector<HTMLAnchorElement>(".group-link");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/device/apollo.yaml");
  });

  test("links a device whose secret prefix keeps the hyphens verbatim", async () => {
    const el = await mount("pintest-direction__zipzip: a\n", false, [
      { name: "pintest-direction", configuration: "pintest.yaml", friendly_name: "Pin" },
    ]);
    const link = el.shadowRoot!.querySelector<HTMLAnchorElement>(".group-link");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/device/pintest.yaml");
  });
});
