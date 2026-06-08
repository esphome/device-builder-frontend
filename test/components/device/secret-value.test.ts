/**
 * @vitest-environment happy-dom
 *
 * Pins the inline secret-value affordance: create-when-missing, and a directly
 * editable value when present (Save only when changed). Every write refreshes
 * the key cache.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
// Stub the confirm dialog (avoids pulling base-dialog / webawesome) while still
// registering a working <esphome-confirm-dialog> with an open() the gate calls.
vi.mock("../../../src/components/confirm-dialog.js", () => {
  class Stub extends HTMLElement {
    open(): void {}
    close(): void {}
  }
  if (!customElements.get("esphome-confirm-dialog")) {
    customElements.define("esphome-confirm-dialog", Stub);
  }
  return {};
});

import toast from "sonner-js";
import type { ESPHomeAPI } from "../../../src/api/esphome-api.js";
import { ESPHomeSecretValue } from "../../../src/components/device/secret-value.js";
import { _resetSecretKeysCache } from "../../../src/util/secrets-cache.js";

async function mount(
  api: Partial<ESPHomeAPI>,
  key: string,
  present: boolean,
  deviceName = ""
): Promise<ESPHomeSecretValue> {
  const el = new ESPHomeSecretValue();
  el.secretKey = key;
  el.present = present;
  el.deviceName = deviceName;
  (el as unknown as { _api: ESPHomeAPI })._api = api as ESPHomeAPI;
  document.body.appendChild(el);
  await el.updateComplete;
  // Present mode prefills the field from secrets.yaml via an async load.
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

const click = async (el: ESPHomeSecretValue, selector: string): Promise<void> => {
  (el.shadowRoot!.querySelector(selector) as HTMLElement).click();
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
};

const pwInput = (el: ESPHomeSecretValue) =>
  el.shadowRoot!.querySelector("esphome-password-input") as unknown as { value: string };

const typeValue = async (el: ESPHomeSecretValue, value: string): Promise<void> => {
  el.shadowRoot!.querySelector("esphome-password-input")!.dispatchEvent(
    new CustomEvent("password-input-change", { detail: { value } })
  );
  await el.updateComplete;
};

afterEach(() => {
  document.body.innerHTML = "";
  _resetSecretKeysCache();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
});

describe("esphome-secret-value", () => {
  it("warns and creates the secret inline when the key is missing", async () => {
    const api = {
      getConfig: vi.fn(async () => "other: x\n"),
      updateConfig: vi.fn(async () => {}),
      getSecretKeys: vi.fn(async () => ["other", "api_key"]),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "api_key", false);

    const msg = el.shadowRoot!.querySelector(".msg")!;
    expect(msg.getAttribute("role")).toBe("alert");

    await typeValue(el, "base64key==");
    await click(el, ".save");

    const [file, content] = (api.updateConfig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(file).toBe("secrets.yaml");
    expect(content).toContain("api_key: base64key==");
    expect(toast.success).toHaveBeenCalled();
    expect(api.getSecretKeys).toHaveBeenCalled(); // cache refreshed
  });

  it("won't create an empty/whitespace secret", async () => {
    const api = {
      getConfig: vi.fn(async () => ""),
      updateConfig: vi.fn(async () => {}),
      getSecretKeys: vi.fn(async () => []),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "api_key", false);
    const saveBtn = () => el.shadowRoot!.querySelector(".save") as HTMLButtonElement;

    expect(saveBtn().disabled).toBe(true); // blank
    await typeValue(el, "   "); // whitespace only
    expect(saveBtn().disabled).toBe(true);
    // Enter is guarded too.
    el.shadowRoot!.querySelector("esphome-password-input")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true })
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(api.updateConfig).not.toHaveBeenCalled();

    await typeValue(el, "real");
    expect(saveBtn().disabled).toBe(false);
  });

  it("prefills the value directly (no pencil) and disables Save until changed", async () => {
    const api = {
      getConfig: vi.fn(async () => "api_key: stored\n"),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "api_key", true);

    // No view/edit toggle — the value is editable straight away.
    expect(el.shadowRoot!.querySelector(".edit")).toBeNull();
    expect(el.shadowRoot!.querySelector("esphome-secret-reveal")).toBeNull();
    expect(pwInput(el).value).toBe("stored");
    // Present mode uses the generic "Value" placeholder, not the create copy.
    expect(
      (
        el.shadowRoot!.querySelector("esphome-password-input") as unknown as {
          placeholder: string;
        }
      ).placeholder
    ).toBe("device.secret_picker_value");
    // Unchanged → Save disabled.
    expect((el.shadowRoot!.querySelector(".save") as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it("enables Save once the value changes and overwrites on save", async () => {
    // Device-specific key so the save isn't gated by the shared-secret confirm.
    const api = {
      getConfig: vi.fn(async () => "kitchen__api_key: oldvalue\nother: y\n"),
      updateConfig: vi.fn(async () => {}),
      getSecretKeys: vi.fn(async () => ["kitchen__api_key", "other"]),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "kitchen__api_key", true, "kitchen");
    expect(pwInput(el).value).toBe("oldvalue");

    await typeValue(el, "newvalue");
    expect((el.shadowRoot!.querySelector(".save") as HTMLButtonElement).disabled).toBe(
      false
    );

    await click(el, ".save");

    const [, content] = (api.updateConfig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toContain("kitchen__api_key: newvalue");
    expect(content).toContain("other: y"); // other secrets preserved
    expect(content).not.toContain("oldvalue");
    expect(toast.success).toHaveBeenCalled();
    // Saved value is now the baseline → Save disabled again.
    expect((el.shadowRoot!.querySelector(".save") as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it("confirms before overwriting a shared secret, then writes on confirm", async () => {
    const api = {
      getConfig: vi.fn(async () => "wifi_password: old\n"),
      updateConfig: vi.fn(async () => {}),
      getSecretKeys: vi.fn(async () => ["wifi_password"]),
    } as unknown as ESPHomeAPI;
    // wifi_password is shared (not this device's `<host>__` namespace).
    const el = await mount(api, "wifi_password", true, "kitchen");

    await typeValue(el, "newpass");
    await click(el, ".save");
    // Write is deferred until the user confirms.
    expect(api.updateConfig).not.toHaveBeenCalled();

    el.shadowRoot!.querySelector("esphome-confirm-dialog")!.dispatchEvent(
      new CustomEvent("confirm")
    );
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    const [, content] = (api.updateConfig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toContain("wifi_password: newpass");
  });

  it("saves a device-specific secret without confirmation", async () => {
    const api = {
      getConfig: vi.fn(async () => "kitchen__encryption_key: old\n"),
      updateConfig: vi.fn(async () => {}),
      getSecretKeys: vi.fn(async () => ["kitchen__encryption_key"]),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "kitchen__encryption_key", true, "kitchen");

    await typeValue(el, "newkey");
    await click(el, ".save");

    // This device's own secret → no prompt, write goes straight through.
    const [, content] = (api.updateConfig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toContain("kitchen__encryption_key: newkey");
  });

  it("disables the field while the stored value is loading", async () => {
    let resolveGet!: (yaml: string) => void;
    const api = {
      getConfig: vi.fn(() => new Promise<string>((r) => (resolveGet = r))),
    } as unknown as ESPHomeAPI;
    const el = new ESPHomeSecretValue();
    el.secretKey = "api_key";
    el.present = true;
    (el as unknown as { _api: ESPHomeAPI })._api = api;
    document.body.appendChild(el);
    await el.updateComplete;

    // Load in flight → input disabled so an async prefill can't clobber typing.
    expect(
      (
        el.shadowRoot!.querySelector("esphome-password-input") as unknown as {
          disabled: boolean;
        }
      ).disabled
    ).toBe(true);

    resolveGet("api_key: stored\n");
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(pwInput(el).value).toBe("stored");
    expect(
      (
        el.shadowRoot!.querySelector("esphome-password-input") as unknown as {
          disabled: boolean;
        }
      ).disabled
    ).toBe(false);
  });

  it("reloads the value and resets the draft when present flips", async () => {
    // Draft from the pre-keys-load window must not survive a missing→present flip.
    const api = {
      getConfig: vi.fn(async () => "api_key: stored\n"),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "api_key", true);

    await typeValue(el, "halftyped");
    el.present = false;
    await el.updateComplete;
    el.present = true;
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    // Back to the freshly-loaded stored value, not the abandoned draft.
    expect(pwInput(el).value).toBe("stored");
  });
});
