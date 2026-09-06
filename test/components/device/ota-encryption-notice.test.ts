/**
 * @vitest-environment happy-dom
 *
 * Pins the OTA encryption notice: both copy variants, silence when a gate
 * fails, the CTA event, and dismissal.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { ESPHomeOtaEncryptionNotice } from "../../../src/components/device/ota-encryption-notice.js";

const NOISE = "Noise_NNpsk0_25519_ChaChaPoly_SHA256";
const YAML = 'api:\n  encryption:\n    key: "abc"\nota:\n  - platform: esphome\n';

async function mount(
  yaml: string,
  deployed_version = "2026.9.0",
  active: string | null = NOISE
) {
  const el = new ESPHomeOtaEncryptionNotice();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (el as any)._localize = (key: string) => key;
  (el as any)._esphomeVersion = "2026.9.0";
  (el as any)._devices = [
    makeConfiguredDevice({
      api_enabled: true,
      api_encrypted: true,
      runtime_state: { deployed_version, api_encryption_active: active },
    }),
  ];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  el.configuration = "kitchen.yaml";
  el.yaml = yaml;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ota-encryption-notice", () => {
  it("renders the add variant with a CTA", async () => {
    const el = await mount(YAML);
    const notice = el.shadowRoot!.querySelector(".notice");
    expect(notice?.textContent).toContain("device.ota_encryption_notice_add");
    expect(notice?.querySelector(".cta")?.textContent).toContain(
      "device.ota_encryption_enable"
    );
  });

  it("renders the replace-password variant", async () => {
    const el = await mount(`${YAML}    password: x\n`);
    expect(el.shadowRoot!.querySelector(".notice")?.textContent).toContain(
      "device.ota_encryption_notice_replace_password"
    );
  });

  it("renders the drop-own-key variant with its own CTA event", async () => {
    const el = await mount(
      `${YAML}    encryption:\n      key: "abc"\n`,
      "2026.8.0",
      null
    );
    const notice = el.shadowRoot!.querySelector(".notice");
    expect(notice?.textContent).toContain("device.ota_encryption_notice_drop_own_key");
    expect(notice?.querySelector(".cta")?.textContent).toContain(
      "device.ota_encryption_use_api_key"
    );
    const seen = vi.fn();
    el.addEventListener("request-drop-ota-encryption-key", seen);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".cta")?.click();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("stays hidden when the firmware is a beta or Noise is not reported", async () => {
    expect(
      (await mount(YAML, "2026.9.0b2")).shadowRoot!.querySelector(".notice")
    ).toBeNull();
    expect(
      (await mount(YAML, "2026.9.0", "")).shadowRoot!.querySelector(".notice")
    ).toBeNull();
    expect(
      (await mount(YAML, "2026.9.0", null)).shadowRoot!.querySelector(".notice")
    ).toBeNull();
  });

  it("clears live once the draft carries encryption", async () => {
    const el = await mount(YAML);
    expect(el.shadowRoot!.querySelector(".notice")).not.toBeNull();
    el.yaml = `${YAML}    encryption:\n`;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".notice")).toBeNull();
  });

  it("emits request-enable-ota-encryption from the CTA and hides on dismiss", async () => {
    const el = await mount(YAML);
    const seen = vi.fn();
    el.addEventListener("request-enable-ota-encryption", seen);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".cta")?.click();
    expect(seen).toHaveBeenCalledTimes(1);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".notice-close")?.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".notice")).toBeNull();
    // A different variant is a different message and shows again.
    el.yaml = `${YAML}    password: x\n`;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".notice")?.textContent).toContain(
      "device.ota_encryption_notice_replace_password"
    );
  });
});
