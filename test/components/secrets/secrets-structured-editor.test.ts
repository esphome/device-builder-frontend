// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";

import { ESPHomeSecretsStructuredEditor } from "../../../src/components/secrets/secrets-structured-editor.js";

async function mount(
  value: string,
  reveal = false
): Promise<ESPHomeSecretsStructuredEditor> {
  const el = new ESPHomeSecretsStructuredEditor();
  el.value = value;
  el.revealSensitive = reveal;
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

  test("adding a secret appends a placeholder entry", async () => {
    const el = await mount("wifi_ssid: home\n");
    const captured = onChange(el);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".add-btn")!.click();
    expect(captured.value).toBe('wifi_ssid: home\nnew_secret: ""\n');
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
});
