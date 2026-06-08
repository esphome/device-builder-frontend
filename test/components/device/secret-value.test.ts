/**
 * @vitest-environment happy-dom
 *
 * Pins the inline secret-value affordance: create-when-missing, reveal +
 * inline edit when present, and that every write refreshes the key cache.
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
  return el;
}

const click = async (el: ESPHomeSecretValue, selector: string): Promise<void> => {
  (el.shadowRoot!.querySelector(selector) as HTMLElement).click();
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
};

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
    expect(el.shadowRoot!.querySelector("esphome-secret-reveal")).toBeNull();

    await typeValue(el, "base64key==");
    await click(el, ".save");

    const [file, content] = (api.updateConfig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(file).toBe("secrets.yaml");
    expect(content).toContain("api_key: base64key==");
    expect(toast.success).toHaveBeenCalled();
    expect(api.getSecretKeys).toHaveBeenCalled(); // cache refreshed
  });

  it("reveals the value with an edit affordance when present", async () => {
    const api = {
      getConfig: vi.fn(async () => "api_key: stored\n"),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "api_key", true);

    const reveal = el.shadowRoot!.querySelector("esphome-secret-reveal")!;
    expect(reveal).not.toBeNull();
    expect(reveal.getAttribute("resetkey")).toBe("api_key");
    expect(el.shadowRoot!.querySelector(".edit")).not.toBeNull();
    // No editor until the pencil is clicked.
    expect(el.shadowRoot!.querySelector("esphome-password-input")).toBeNull();
  });

  it("prefills the current value when editing, then overwrites it on save", async () => {
    const api = {
      getConfig: vi.fn(async () => "api_key: oldvalue\nother: y\n"),
      updateConfig: vi.fn(async () => {}),
      getSecretKeys: vi.fn(async () => ["api_key", "other"]),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "api_key", true);

    await click(el, ".edit");
    // The editor is prefilled with the resolved current value.
    expect(
      (
        el.shadowRoot!.querySelector("esphome-password-input") as unknown as {
          value: string;
        }
      ).value
    ).toBe("oldvalue");

    await typeValue(el, "newvalue");
    await click(el, ".save");

    const [, content] = (api.updateConfig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toContain("api_key: newvalue");
    expect(content).toContain("other: y"); // other secrets preserved
    expect(content).not.toContain("oldvalue");
    expect(toast.success).toHaveBeenCalled();
    // Back to the reveal once saved.
    expect(el.shadowRoot!.querySelector("esphome-secret-reveal")).not.toBeNull();
  });

  it("cancels an edit without writing", async () => {
    const api = {
      getConfig: vi.fn(async () => "api_key: stored\n"),
      updateConfig: vi.fn(async () => {}),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "api_key", true);

    await click(el, ".edit");
    await typeValue(el, "discarded");
    await click(el, ".cancel");

    expect(api.updateConfig).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("esphome-secret-reveal")).not.toBeNull();
  });

  it("drops edit state when the target key changes", async () => {
    const api = {
      getConfig: vi.fn(async () => "api_key: stored\n"),
    } as unknown as ESPHomeAPI;
    const el = await mount(api, "api_key", true);

    await click(el, ".edit");
    expect(el.shadowRoot!.querySelector("esphome-password-input")).not.toBeNull();

    el.secretKey = "other_key";
    await el.updateComplete;
    // New target → back to the reveal, no stale editor/draft.
    expect(el.shadowRoot!.querySelector("esphome-password-input")).toBeNull();
    expect(el.shadowRoot!.querySelector("esphome-secret-reveal")).not.toBeNull();
  });
});
