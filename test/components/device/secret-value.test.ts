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
  _resetSecretKeysCache();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
});

describe("esphome-secret-value", () => {
  it("warns and creates the secret inline when the key is missing", async () => {
    const api = {
      getConfig: vi.fn(async () => "other: x\n"),
      setSecret: vi.fn(async () => ({ created: true })),
      getSecretKeys: vi.fn(async () => ["other", "api_key"]),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "api_key", false);

    const msg = el.shadowRoot!.querySelector(".msg")!;
    expect(msg.getAttribute("role")).toBe("alert");

    await typeValue(el, "base64key==");
    await click(el, ".save");

    // Create path is create-if-absent (overwrite=false).
    expect(api.setSecret).toHaveBeenCalledWith("api_key", "base64key==", false);
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
      setSecret: vi.fn(async () => ({ created: false })),
      getSecretKeys: vi.fn(async () => ["kitchen__api_key", "other"]),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "kitchen__api_key", true, "kitchen");
    expect(pwInput(el).value).toBe("oldvalue");

    await typeValue(el, "newvalue");
    expect((el.shadowRoot!.querySelector(".save") as HTMLButtonElement).disabled).toBe(
      false
    );

    await click(el, ".save");

    // Edit path always overwrites (overwrite=true).
    expect(api.setSecret).toHaveBeenCalledWith("kitchen__api_key", "newvalue", true);
    expect(toast.success).toHaveBeenCalled();
    // Saved value is now the baseline → Save disabled again.
    expect((el.shadowRoot!.querySelector(".save") as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it("confirms before overwriting a shared secret, then writes on confirm", async () => {
    const api = {
      getConfig: vi.fn(async () => "wifi_password: old\n"),
      setSecret: vi.fn(async () => ({ created: false })),
      getSecretKeys: vi.fn(async () => ["wifi_password"]),
    } as unknown as ESPHomeAPI;
    // wifi_password is shared (not this device's `<host>__` namespace).
    const el = await mount(api, "wifi_password", true, "kitchen");

    await typeValue(el, "newpass");
    await click(el, ".save");
    // Write is deferred until the user confirms.
    expect(api.setSecret).not.toHaveBeenCalled();

    el.shadowRoot!.querySelector("esphome-confirm-dialog")!.dispatchEvent(
      new CustomEvent("confirm")
    );
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(api.setSecret).toHaveBeenCalledWith("wifi_password", "newpass", true);
  });

  it("saves a device-specific secret without confirmation", async () => {
    const api = {
      getConfig: vi.fn(async () => "kitchen__encryption_key: old\n"),
      setSecret: vi.fn(async () => ({ created: false })),
      getSecretKeys: vi.fn(async () => ["kitchen__encryption_key"]),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "kitchen__encryption_key", true, "kitchen");

    await typeValue(el, "newkey");
    await click(el, ".save");

    // This device's own secret → no prompt, write goes straight through.
    expect(api.setSecret).toHaveBeenCalledWith("kitchen__encryption_key", "newkey", true);
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

    // Load in flight → input disabled so an async prefill can't clobber typing,
    // and copy disabled so it can't copy the empty initial draft.
    const pwDisabled = () =>
      (
        el.shadowRoot!.querySelector("esphome-password-input") as unknown as {
          disabled: boolean;
        }
      ).disabled;
    const copyBtn = () => el.shadowRoot!.querySelector(".copy") as HTMLButtonElement;
    expect(pwDisabled()).toBe(true);
    expect(copyBtn().disabled).toBe(true);

    resolveGet("api_key: stored\n");
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(pwInput(el).value).toBe("stored");
    expect(pwDisabled()).toBe(false);
    expect(copyBtn().disabled).toBe(false);
  });

  it("shows an error with retry (not an empty editable field) when the load fails", async () => {
    let calls = 0;
    const api = {
      getConfig: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error("ws blip");
        return "api_key: real\n";
      }),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "api_key", true);

    // Failed read → error state, no editable field to overwrite the real value.
    expect(el.shadowRoot!.querySelector(".msg")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("esphome-password-input")).toBeNull();
    expect(toast.error).toHaveBeenCalled();

    // Retry re-fetches and recovers.
    await click(el, ".retry");
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(pwInput(el).value).toBe("real");
  });

  it("fetches the stored value once despite re-renders during the load", async () => {
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

    // Re-render repeatedly while the load is still in flight (e.g. contexts settling).
    el.requestUpdate();
    await el.updateComplete;
    el.requestUpdate();
    await el.updateComplete;

    // Still a single read — the in-flight guard dedupes the updated() kicks.
    expect((api.getConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

    resolveGet("api_key: stored\n");
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(pwInput(el).value).toBe("stored");
  });

  it("a stale write completion doesn't clear a newer operation's busy state", async () => {
    let resolveA!: () => void;
    let resolveB!: () => void;
    let n = 0;
    const api = {
      getConfig: vi.fn(async () => ""), // both keys absent → create path
      setSecret: vi.fn(
        () =>
          new Promise<{ created: boolean }>((r) => {
            n += 1;
            if (n === 1) resolveA = () => r({ created: true });
            else resolveB = () => r({ created: true });
          })
      ),
      getSecretKeys: vi.fn(async () => []),
    } as unknown as ESPHomeAPI;
    const saveBtn = () => el.shadowRoot!.querySelector(".save") as HTMLButtonElement;

    const el = await mount(api, "kitchen__a", false, "kitchen");
    await typeValue(el, "aval");
    await click(el, ".save"); // write A in flight (updateConfig#1 pending)

    // Switch target, then start write B.
    el.secretKey = "kitchen__b";
    await el.updateComplete;
    await typeValue(el, "bval");
    await click(el, ".save"); // write B in flight; busy=true for B
    expect(saveBtn().disabled).toBe(true);

    // The stale write A resolves — must NOT clear B's busy (else B's button
    // re-enables mid-write). Without the op-token guard this would be enabled.
    resolveA();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(saveBtn().disabled).toBe(true);

    // B completes normally (both writes were issued).
    resolveB();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect((api.setSecret as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
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
