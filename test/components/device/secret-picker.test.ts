/**
 * @vitest-environment happy-dom
 *
 * Pins the inline secret picker: it lists the cached secret keys plus a
 * "Create new secret…" action, emits ``secret-selected`` with a
 * ``!secret <key>`` literal when a key is chosen, and routes to the secrets
 * editor for the create action.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/divider/divider.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/dropdown/dropdown.js", () => ({}));
vi.mock(
  "@home-assistant/webawesome/dist/components/dropdown-item/dropdown-item.js",
  () => ({})
);
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("../../../src/util/navigation.js", () => ({ navigate }));
vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import toast from "sonner-js";
import type { ESPHomeAPI } from "../../../src/api/esphome-api.js";
import { ESPHomeSecretPicker } from "../../../src/components/device/secret-picker.js";
import {
  _resetSecretKeysCache,
  fetchSecretKeys,
} from "../../../src/util/secrets-cache.js";

const makeApi = (keys: string[]): ESPHomeAPI =>
  ({ getSecretKeys: vi.fn(async () => keys) }) as unknown as ESPHomeAPI;

async function mount(keys: string[]): Promise<ESPHomeSecretPicker> {
  // Prime the shared cache before constructing — the element seeds `_keys`
  // from `getCachedSecretKeys()` in its field initializer.
  await fetchSecretKeys(makeApi(keys));
  const el = new ESPHomeSecretPicker();
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const items = (el: ESPHomeSecretPicker): HTMLElement[] =>
  Array.from(el.shadowRoot!.querySelectorAll("wa-dropdown-item"));

/** Fire wa-select for a plain key item (carries a `value`, no action class). */
const fireSelect = (el: ESPHomeSecretPicker, value: string): void => {
  el.shadowRoot!.querySelector("wa-dropdown")!.dispatchEvent(
    new CustomEvent("wa-select", { detail: { item: { value } } })
  );
};

/** Fire wa-select for a real rendered item (the picker detects actions by the
 *  item's class, so action tests must pass the actual element). */
const fireSelectItem = (el: ESPHomeSecretPicker, selector: string): void => {
  const item = el.shadowRoot!.querySelector(selector)!;
  el.shadowRoot!.querySelector("wa-dropdown")!.dispatchEvent(
    new CustomEvent("wa-select", { detail: { item } })
  );
};

afterEach(() => {
  document.body.innerHTML = "";
  _resetSecretKeysCache();
  navigate.mockClear();
});

describe("esphome-secret-picker", () => {
  it("renders one item per cached key plus the create action", async () => {
    const el = await mount(["wifi_ssid", "wifi_password"]);
    const values = items(el).map((i) => i.getAttribute("value"));
    expect(values).toContain("wifi_ssid");
    expect(values).toContain("wifi_password");
    // The last item is the create action.
    expect(el.shadowRoot!.querySelector(".create")).not.toBeNull();
  });

  it("shows the empty placeholder when there are no secrets", async () => {
    const el = await mount([]);
    expect(el.shadowRoot!.querySelector(".empty")).not.toBeNull();
    // Create action is still offered when the file is empty.
    expect(el.shadowRoot!.querySelector(".create")).not.toBeNull();
  });

  it("emits secret-selected with a !secret reference when a key is picked", async () => {
    const el = await mount(["wifi_ssid"]);
    const onSelected = vi.fn();
    el.addEventListener("secret-selected", onSelected as EventListener);

    fireSelect(el, "wifi_ssid");

    expect(onSelected).toHaveBeenCalledTimes(1);
    expect((onSelected.mock.calls[0][0] as CustomEvent).detail.value).toBe(
      "!secret wifi_ssid"
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows the selected key in the trigger and flags the active item", async () => {
    const el = await mount(["wifi_ssid", "wifi_password"]);
    el.selectedKey = "wifi_ssid";
    await el.updateComplete;

    const trigger = el.shadowRoot!.querySelector(".trigger")!;
    expect(trigger.classList.contains("selected")).toBe(true);
    expect(trigger.textContent).toContain("wifi_ssid");

    const active = items(el).find((i) => i.getAttribute("aria-selected") === "true");
    expect(active?.getAttribute("value")).toBe("wifi_ssid");
  });

  it("shows the placeholder label when no secret is selected", async () => {
    const el = await mount(["wifi_ssid"]);
    expect(el.shadowRoot!.querySelector(".trigger")!.classList.contains("selected")).toBe(
      false
    );
    expect(el.shadowRoot!.querySelector(".placeholder")).not.toBeNull();
  });

  it("routes to the secrets editor for the create action", async () => {
    const el = await mount(["wifi_ssid"]);
    const onSelected = vi.fn();
    el.addEventListener("secret-selected", onSelected as EventListener);

    fireSelectItem(el, ".create");

    expect(navigate).toHaveBeenCalledWith("/secrets");
    expect(onSelected).not.toHaveBeenCalled();
  });

  it("emits a !secret reference for a key whose name equals an action sentinel", async () => {
    // A stored secret literally named like the create sentinel must still be
    // referenced, not hijack the create action (detection is class-based).
    const el = await mount(["__esphome_create_secret__"]);
    const onSelected = vi.fn();
    el.addEventListener("secret-selected", onSelected as EventListener);

    fireSelect(el, "__esphome_create_secret__");

    expect(navigate).not.toHaveBeenCalled();
    expect((onSelected.mock.calls[0][0] as CustomEvent).detail.value).toBe(
      "!secret __esphome_create_secret__"
    );
  });

  it("groups recommended keys above the rest", async () => {
    const el = await mount(["other_secret", "wifi_ssid"]);
    el.recommendedKeys = ["wifi_ssid"];
    await el.updateComplete;

    const labels = Array.from(el.shadowRoot!.querySelectorAll(".group-label")).map((l) =>
      l.textContent!.trim()
    );
    expect(labels).toEqual([
      "device.secret_picker_recommended",
      "device.secret_picker_other",
    ]);
  });

  it("inlines the secret's value when reverting to manual entry", async () => {
    const el = await mount(["wifi_ssid"]);
    const api = {
      getConfig: vi.fn(async () => 'wifi_ssid: "myssid"\n'),
    } as unknown as ESPHomeAPI;
    (el as unknown as { _api: ESPHomeAPI })._api = api;
    el.selectedKey = "wifi_ssid";
    await el.updateComplete;
    const onSelected = vi.fn();
    el.addEventListener("secret-selected", onSelected as EventListener);

    fireSelectItem(el, ".manual");
    await new Promise((r) => setTimeout(r, 0));

    expect(api.getConfig).toHaveBeenCalledWith("secrets.yaml");
    expect((onSelected.mock.calls[0][0] as CustomEvent).detail.value).toBe("myssid");
  });

  it("keeps the !secret reference when the manual read fails", async () => {
    const el = await mount(["wifi_ssid"]);
    const api = {
      getConfig: vi.fn(async () => {
        throw new Error("ws blip");
      }),
    } as unknown as ESPHomeAPI;
    (el as unknown as { _api: ESPHomeAPI })._api = api;
    el.selectedKey = "wifi_ssid";
    await el.updateComplete;
    const onSelected = vi.fn();
    el.addEventListener("secret-selected", onSelected as EventListener);

    fireSelectItem(el, ".manual");
    await new Promise((r) => setTimeout(r, 0));

    // A transient read failure must not replace the reference with a blank.
    expect(onSelected).not.toHaveBeenCalled();
  });

  it("inlines an empty value when the secret key is genuinely absent", async () => {
    const el = await mount(["wifi_ssid"]);
    const api = {
      getConfig: vi.fn(async () => "other_key: x\n"),
    } as unknown as ESPHomeAPI;
    (el as unknown as { _api: ESPHomeAPI })._api = api;
    el.selectedKey = "wifi_ssid";
    await el.updateComplete;
    const onSelected = vi.fn();
    el.addEventListener("secret-selected", onSelected as EventListener);

    fireSelectItem(el, ".manual");
    await new Promise((r) => setTimeout(r, 0));

    // Key absent (read succeeded) → a legit empty inline, not an error.
    expect((onSelected.mock.calls[0][0] as CustomEvent).detail.value).toBe("");
  });

  it("migrates an inline value into the preferred (double-underscore) secret", async () => {
    const el = await mount([]); // neither recommended form on disk yet
    const api = {
      getConfig: vi.fn(async () => "wifi_ssid: x\n"),
      updateConfig: vi.fn(async () => {}),
      getSecretKeys: vi.fn(async () => []),
    } as unknown as ESPHomeAPI;
    (el as unknown as { _api: ESPHomeAPI })._api = api;
    el.value = "plaintextpw";
    // Preferred `__` form first, single-underscore back-compat alias second.
    el.recommendedKeys = ["kitchen__ota_password", "kitchen_ota_password"];
    await el.updateComplete;

    const onSelected = vi.fn();
    el.addEventListener("secret-selected", onSelected as EventListener);
    const saved = vi.fn();
    window.addEventListener("secrets-saved", saved as EventListener);

    fireSelectItem(el, ".migrate");
    await new Promise((r) => setTimeout(r, 0)); // let the async write settle

    expect(api.updateConfig).toHaveBeenCalledTimes(1);
    const [file, content] = (api.updateConfig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(file).toBe("secrets.yaml");
    // The double-underscore form is created, never the back-compat alias.
    expect(content).toContain("kitchen__ota_password: plaintextpw");
    expect(content).not.toContain("kitchen_ota_password: plaintextpw");
    expect(content).toContain("wifi_ssid: x");
    expect(saved).toHaveBeenCalled();
    expect((onSelected.mock.calls[0][0] as CustomEvent).detail.value).toBe(
      "!secret kitchen__ota_password"
    );
    window.removeEventListener("secrets-saved", saved as EventListener);
  });

  it("aborts the migration (no write, no field change) when the read fails", async () => {
    const el = await mount([]);
    const api = {
      getConfig: vi.fn(async () => {
        throw new Error("ws blip");
      }),
      updateConfig: vi.fn(async () => {}),
      getSecretKeys: vi.fn(async () => []),
    } as unknown as ESPHomeAPI;
    (el as unknown as { _api: ESPHomeAPI })._api = api;
    el.value = "plaintextpw";
    el.recommendedKeys = ["kitchen__ota_password"];
    await el.updateComplete;

    const onSelected = vi.fn();
    el.addEventListener("secret-selected", onSelected as EventListener);

    fireSelectItem(el, ".migrate");
    await new Promise((r) => setTimeout(r, 0));

    // A read failure must never lead to a write that could clobber secrets.yaml.
    expect(api.updateConfig).not.toHaveBeenCalled();
    expect(onSelected).not.toHaveBeenCalled();
  });

  it("points at the existing key instead of appending a duplicate (stale cache)", async () => {
    // Cache says empty, but the freshly-read file already defines the key.
    const el = await mount([]);
    const api = {
      getConfig: vi.fn(async () => "kitchen__ota_password: alreadythere\n"),
      updateConfig: vi.fn(async () => {}),
      getSecretKeys: vi.fn(async () => []),
    } as unknown as ESPHomeAPI;
    (el as unknown as { _api: ESPHomeAPI })._api = api;
    el.value = "plaintextpw";
    el.recommendedKeys = ["kitchen__ota_password"];
    await el.updateComplete;

    const onSelected = vi.fn();
    el.addEventListener("secret-selected", onSelected as EventListener);

    fireSelectItem(el, ".migrate");
    await new Promise((r) => setTimeout(r, 0));

    // No duplicate write; just reference the existing key, with a distinct
    // "linked" toast (its value may differ from what the user typed).
    expect(api.updateConfig).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalled();
    expect((onSelected.mock.calls[0][0] as CustomEvent).detail.value).toBe(
      "!secret kitchen__ota_password"
    );
  });

  it("offers no migrate when the preferred secret already exists", async () => {
    // The `__` form is on disk; the single-underscore alias is not, but it must
    // not be offered as a migrate target — the user should select the existing.
    const el = await mount(["kitchen__ota_password"]);
    el.value = "plaintextpw";
    el.recommendedKeys = ["kitchen__ota_password", "kitchen_ota_password"];
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".migrate")).toBeNull();
  });

  it("offers no migrate action when there's no inline value", async () => {
    const el = await mount([]);
    el.recommendedKeys = ["kitchen__ota_password"];
    el.value = "";
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".migrate")).toBeNull();
  });
});
