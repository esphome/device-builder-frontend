/**
 * @vitest-environment happy-dom
 *
 * Pins the inline create-missing-secret affordance: it warns about the absent
 * key, writes the typed value to secrets.yaml (appending, never clobbering),
 * toasts the outcome, and refreshes the key cache so the picker self-heals.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import toast from "sonner-js";
import type { ESPHomeAPI } from "../../../src/api/esphome-api.js";
import { ESPHomeSecretMissing } from "../../../src/components/device/secret-missing.js";
import { _resetSecretKeysCache } from "../../../src/util/secrets-cache.js";

async function mount(
  api: Partial<ESPHomeAPI>,
  key: string
): Promise<ESPHomeSecretMissing> {
  const el = new ESPHomeSecretMissing();
  el.secretKey = key;
  (el as unknown as { _api: ESPHomeAPI })._api = api as ESPHomeAPI;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const clickCreate = async (el: ESPHomeSecretMissing): Promise<void> => {
  (el.shadowRoot!.querySelector(".create") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
};

// The value field is an <esphome-password-input>; drive it via its change event.
const typeValue = async (el: ESPHomeSecretMissing, value: string): Promise<void> => {
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

describe("esphome-secret-missing", () => {
  it("renders the warning, a masked value field, and a create button", async () => {
    const el = await mount({}, "this_secret_is_missing");
    const msg = el.shadowRoot!.querySelector(".msg")!;
    expect(msg.textContent).toContain("device.secret_picker_missing");
    expect(msg.getAttribute("role")).toBe("alert"); // announced to screen readers
    const field = el.shadowRoot!.querySelector("esphome-password-input");
    expect(field).not.toBeNull();
    // Carries an accessible name rather than relying on a placeholder.
    expect((field as unknown as { label: string }).label).toContain(
      "device.secret_picker_missing_label"
    );
    expect(el.shadowRoot!.querySelector(".create")).not.toBeNull();
  });

  it("appends the typed value to secrets.yaml and fires secrets-saved", async () => {
    const api = {
      getConfig: vi.fn(async () => "other_key: x\n"),
      updateConfig: vi.fn(async () => {}),
      getSecretKeys: vi.fn(async () => ["other_key", "this_secret_is_missing"]),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "this_secret_is_missing");
    const saved = vi.fn();
    window.addEventListener("secrets-saved", saved as EventListener);

    await typeValue(el, "base64key==");
    await clickCreate(el);

    const [file, content] = (api.updateConfig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(file).toBe("secrets.yaml");
    expect(content).toContain("this_secret_is_missing: base64key==");
    expect(content).toContain("other_key: x"); // existing secrets preserved
    expect(saved).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
    window.removeEventListener("secrets-saved", saved as EventListener);
  });

  it("allows creating an empty placeholder secret", async () => {
    const api = {
      getConfig: vi.fn(async () => ""),
      updateConfig: vi.fn(async () => {}),
      getSecretKeys: vi.fn(async () => ["placeholder_secret"]),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "placeholder_secret");

    await clickCreate(el);

    expect(api.updateConfig).toHaveBeenCalledTimes(1);
    const [, content] = (api.updateConfig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toContain("placeholder_secret:");
  });

  it("links to an existing key (no write) and refreshes the cache so the warning can clear", async () => {
    const api = {
      getConfig: vi.fn(async () => "this_secret_is_missing: alreadythere\n"),
      updateConfig: vi.fn(async () => {}),
      getSecretKeys: vi.fn(async () => ["this_secret_is_missing"]),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "this_secret_is_missing");

    await typeValue(el, "newvalue");
    await clickCreate(el);

    expect(api.updateConfig).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalled();
    // The linked path doesn't fire secrets-saved, so the key cache is refreshed
    // directly — otherwise a stale cache would keep the picker flagged missing.
    expect(api.getSecretKeys).toHaveBeenCalled();
  });

  it("surfaces an error and does not write when the read fails", async () => {
    const api = {
      getConfig: vi.fn(async () => {
        throw new Error("ws blip");
      }),
      updateConfig: vi.fn(async () => {}),
      getSecretKeys: vi.fn(async () => []),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "this_secret_is_missing");

    await typeValue(el, "x");
    await clickCreate(el);

    expect(api.updateConfig).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(api.getSecretKeys).not.toHaveBeenCalled(); // no refresh on failure
  });
});
