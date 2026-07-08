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
// secret-value (rendered for a selected key) pulls in confirm-dialog → wa-button,
// which trips happy-dom's form-associated path; stub it (mirrors security-notice).
vi.mock("../../../src/components/confirm-dialog.js", () => ({}));

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
import { flush } from "../../_dom.js";

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
  _resetSecretKeysCache();
  navigate.mockClear();
});

describe("esphome-secret-picker", () => {
  it("renders one item per cached key plus the create action", async () => {
    const el = await mount(["secret_a", "secret_b"]);
    const values = items(el).map((i) => i.getAttribute("value"));
    expect(values).toContain("secret_a");
    expect(values).toContain("secret_b");
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

  it("renders the value affordance (present) for a selected existing key", async () => {
    const el = await mount(["wifi_ssid"]);
    expect(el.shadowRoot!.querySelector("esphome-secret-value")).toBeNull(); // none until selected
    el.selectedKey = "wifi_ssid";
    await el.updateComplete;
    const val = el.shadowRoot!.querySelector("esphome-secret-value")!;
    expect(val.getAttribute("secret-key")).toBe("wifi_ssid");
    // Key is in the loaded list → present (reveal + edit), not the create flow.
    expect((val as unknown as { present: boolean }).present).toBe(true);
  });

  it("flags a referenced secret absent from the loaded list", async () => {
    const el = await mount(["wifi_ssid"]);
    el.selectedKey = "this_secret_is_missing";
    await el.updateComplete;

    const trigger = el.shadowRoot!.querySelector(".trigger")!;
    expect(trigger.classList.contains("missing")).toBe(true);
    expect(trigger.querySelector(".key")!.getAttribute("name")).toBe("alert");
    const val = el.shadowRoot!.querySelector("esphome-secret-value")!;
    expect(val.getAttribute("secret-key")).toBe("this_secret_is_missing");
    // Not present → the value affordance shows the inline create flow.
    expect((val as unknown as { present: boolean }).present).toBe(false);
  });

  it("does not flag a referenced secret before the key list has loaded", async () => {
    // No fetch primes the cache, so `getCachedSecretKeys()` is undefined.
    const el = new ESPHomeSecretPicker();
    el.selectedKey = "this_secret_is_missing";
    document.body.appendChild(el);
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector(".trigger")!.classList.contains("missing")).toBe(
      false
    );
    // Rendered, but treated as present (reveal) until the list confirms absence.
    const val = el.shadowRoot!.querySelector("esphome-secret-value")!;
    expect((val as unknown as { present: boolean }).present).toBe(true);
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

  it("hides other devices' per-device secrets from the list", async () => {
    const el = await mount([
      "kitchen__encryption_key",
      "porch__encryption_key",
      "x_secret",
    ]);
    (el as unknown as { _devices: { name: string }[] })._devices = [
      { name: "kitchen" },
      { name: "porch" },
    ];
    el.deviceName = "kitchen";
    await el.updateComplete;

    const values = items(el).map((i) => i.getAttribute("value"));
    expect(values).toContain("kitchen__encryption_key");
    expect(values).toContain("x_secret");
    expect(values).not.toContain("porch__encryption_key");
  });

  it("hides wifi_* secrets on a non-WiFi field, shows them on a WiFi field", async () => {
    const el = await mount(["wifi_ssid", "wifi_password", "kitchen__encryption_key"]);
    el.deviceName = "kitchen";

    // Non-WiFi field (encryption key recommended) → no wifi_* offered.
    el.recommendedKeys = ["kitchen__encryption_key"];
    await el.updateComplete;
    let values = items(el).map((i) => i.getAttribute("value"));
    expect(values).not.toContain("wifi_ssid");
    expect(values).not.toContain("wifi_password");
    expect(values).toContain("kitchen__encryption_key");

    // WiFi SSID field → wifi_ssid offered (recommended), wifi_password not.
    el.recommendedKeys = ["wifi_ssid"];
    await el.updateComplete;
    values = items(el).map((i) => i.getAttribute("value"));
    expect(values).toContain("wifi_ssid");
    expect(values).not.toContain("wifi_password");
  });

  it("groups recommended keys above the rest", async () => {
    const el = await mount(["other_secret", "wifi_ssid"]);
    el.recommendedKeys = ["wifi_ssid"];
    await el.updateComplete;

    const labels = Array.from(el.shadowRoot!.querySelectorAll(".group-label")).map((l) =>
      l.textContent!.trim()
    );
    expect(labels).toEqual([
      "device.secret_picker_related",
      "device.secret_picker_shared",
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
    await flush();

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
    await flush();

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
    await flush();

    // Key absent (read succeeded) → a legit empty inline, not an error.
    expect((onSelected.mock.calls[0][0] as CustomEvent).detail.value).toBe("");
  });

  it("migrates an inline value into the preferred (double-underscore) secret", async () => {
    const el = await mount([]); // neither recommended form on disk yet
    const api = {
      setSecret: vi.fn(async () => ({ created: true })),
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
    await flush(); // let the async write settle

    // The double-underscore form is created (create-if-absent), never the alias.
    expect(api.setSecret).toHaveBeenCalledWith(
      "kitchen__ota_password",
      "plaintextpw",
      false
    );
    expect(saved).toHaveBeenCalled();
    expect((onSelected.mock.calls[0][0] as CustomEvent).detail.value).toBe(
      "!secret kitchen__ota_password"
    );
    window.removeEventListener("secrets-saved", saved as EventListener);
  });

  it("aborts the migration (no field change) when the write fails", async () => {
    const el = await mount([]);
    const api = {
      setSecret: vi.fn(async () => {
        throw new Error("ws blip");
      }),
      getSecretKeys: vi.fn(async () => []),
    } as unknown as ESPHomeAPI;
    (el as unknown as { _api: ESPHomeAPI })._api = api;
    el.value = "plaintextpw";
    el.recommendedKeys = ["kitchen__ota_password"];
    await el.updateComplete;

    const onSelected = vi.fn();
    el.addEventListener("secret-selected", onSelected as EventListener);

    fireSelectItem(el, ".migrate");
    await flush();

    // A failed write must never change the field to a !secret ref.
    expect(onSelected).not.toHaveBeenCalled();
  });

  it("points at the existing key instead of appending a duplicate", async () => {
    // The backend reports the key already existed (create-if-absent left it).
    const el = await mount([]);
    const api = {
      setSecret: vi.fn(async () => ({ created: false })),
      getSecretKeys: vi.fn(async () => []),
    } as unknown as ESPHomeAPI;
    (el as unknown as { _api: ESPHomeAPI })._api = api;
    el.value = "plaintextpw";
    el.recommendedKeys = ["kitchen__ota_password"];
    await el.updateComplete;

    const onSelected = vi.fn();
    el.addEventListener("secret-selected", onSelected as EventListener);

    fireSelectItem(el, ".migrate");
    await flush();

    // create-if-absent left the existing value; reference the key with a distinct
    // "linked" toast (its value may differ from what the user typed).
    expect(api.setSecret).toHaveBeenCalledWith(
      "kitchen__ota_password",
      "plaintextpw",
      false
    );
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
