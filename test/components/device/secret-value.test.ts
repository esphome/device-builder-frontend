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

import toast from "sonner-js";
import type { ESPHomeAPI } from "../../../src/api/esphome-api.js";
import { ESPHomeSecretValue } from "../../../src/components/device/secret-value.js";
import { _resetSecretKeysCache } from "../../../src/util/secrets-cache.js";

async function mount(
  api: Partial<ESPHomeAPI>,
  key: string,
  present: boolean
): Promise<ESPHomeSecretValue> {
  const el = new ESPHomeSecretValue();
  el.secretKey = key;
  el.present = present;
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

  it("prefills the value directly (no pencil) and disables Save until changed", async () => {
    const api = {
      getConfig: vi.fn(async () => "api_key: stored\n"),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "api_key", true);

    // No view/edit toggle — the value is editable straight away.
    expect(el.shadowRoot!.querySelector(".edit")).toBeNull();
    expect(el.shadowRoot!.querySelector("esphome-secret-reveal")).toBeNull();
    expect(pwInput(el).value).toBe("stored");
    // Unchanged → Save disabled.
    expect((el.shadowRoot!.querySelector(".save") as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it("enables Save once the value changes and overwrites on save", async () => {
    const api = {
      getConfig: vi.fn(async () => "api_key: oldvalue\nother: y\n"),
      updateConfig: vi.fn(async () => {}),
      getSecretKeys: vi.fn(async () => ["api_key", "other"]),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "api_key", true);
    expect(pwInput(el).value).toBe("oldvalue");

    await typeValue(el, "newvalue");
    expect((el.shadowRoot!.querySelector(".save") as HTMLButtonElement).disabled).toBe(
      false
    );

    await click(el, ".save");

    const [, content] = (api.updateConfig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toContain("api_key: newvalue");
    expect(content).toContain("other: y"); // other secrets preserved
    expect(content).not.toContain("oldvalue");
    expect(toast.success).toHaveBeenCalled();
    // Saved value is now the baseline → Save disabled again.
    expect((el.shadowRoot!.querySelector(".save") as HTMLButtonElement).disabled).toBe(
      true
    );
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
