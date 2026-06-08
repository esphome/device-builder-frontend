/**
 * @vitest-environment happy-dom
 *
 * Pins the inline create-missing-secret affordance: it warns about the absent
 * key, writes the typed value to secrets.yaml (appending, never clobbering),
 * fires `secrets-saved`, and toasts the outcome.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import toast from "sonner-js";
import type { ESPHomeAPI } from "../../../src/api/esphome-api.js";
import { ESPHomeSecretMissing } from "../../../src/components/device/secret-missing.js";

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

const typeValue = async (el: ESPHomeSecretMissing, value: string): Promise<void> => {
  const input = el.shadowRoot!.querySelector(".value") as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await el.updateComplete;
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
});

describe("esphome-secret-missing", () => {
  it("renders the warning, an input, and a create button for the absent key", async () => {
    const el = await mount({}, "this_secret_is_missing");
    expect(el.shadowRoot!.querySelector(".msg")!.textContent).toContain(
      "device.secret_picker_missing"
    );
    expect(el.shadowRoot!.querySelector(".value")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".create")).not.toBeNull();
  });

  it("appends the typed value to secrets.yaml and fires secrets-saved", async () => {
    const api = {
      getConfig: vi.fn(async () => "other_key: x\n"),
      updateConfig: vi.fn(async () => {}),
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
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "placeholder_secret");

    await clickCreate(el);

    expect(api.updateConfig).toHaveBeenCalledTimes(1);
    const [, content] = (api.updateConfig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toContain("placeholder_secret:");
  });

  it("links to an existing key (no duplicate write) when it already exists", async () => {
    const api = {
      getConfig: vi.fn(async () => "this_secret_is_missing: alreadythere\n"),
      updateConfig: vi.fn(async () => {}),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "this_secret_is_missing");

    await typeValue(el, "newvalue");
    await clickCreate(el);

    expect(api.updateConfig).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalled();
  });

  it("surfaces an error and does not write when the read fails", async () => {
    const api = {
      getConfig: vi.fn(async () => {
        throw new Error("ws blip");
      }),
      updateConfig: vi.fn(async () => {}),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "this_secret_is_missing");

    await typeValue(el, "x");
    await clickCreate(el);

    expect(api.updateConfig).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});
