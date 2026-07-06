/**
 * @vitest-environment happy-dom
 *
 * Pins the generalized security nudge across its three settings: detecting a
 * missing marker (api `encryption:`, ota `password:`, web_server `auth:`) and
 * the generate flow that writes secrets.yaml + emits `apply-section-values`.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
// The confirm dialog pulls in wa-button, which doesn't mount under happy-dom;
// the notice + dialog body markup we assert on are the component's own.
vi.mock("../../../src/components/confirm-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import toast from "sonner-js";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import { ESPHomeSecurityNotice } from "../../../src/components/device/security-notice.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
function make(sectionKey: string, yaml: string, fromLine?: number) {
  const el = new ESPHomeSecurityNotice();
  const inner = el as any;
  inner.sectionKey = sectionKey;
  inner.yaml = yaml;
  inner.fromLine = fromLine;
  inner.configuration = "device.yaml";
  return { el, inner };
}

async function mount(
  sectionKey: string,
  yaml: string,
  fromLine?: number,
  devices: { name: string }[] = []
) {
  const { el, inner } = make(sectionKey, yaml, fromLine);
  inner._devices = devices.map((d) => ({ ...d, configuration: "device.yaml" }));
  document.body.appendChild(el);
  await el.updateComplete;
  return { el, inner };
}

describe("security-notice — detection", () => {
  // [name, sectionKey, yaml, fromLine, markerPresent]
  const cases: Array<[string, string, string, number, boolean]> = [
    ["api: key present", "api", "api:\n  encryption:\n    key: abc\n", 1, true],
    ["api: keyless (HA auto-provisions)", "api", "api:\n  encryption:\n", 1, true],
    ["api: absent", "api", "api:\n  id: api_server\n", 1, false],
    [
      "api: deeper-nested encryption (not a direct child)",
      "api",
      "api:\n  actions:\n    - action: x\n      variables:\n        encryption: y\n",
      1,
      false,
    ],
    [
      "ota: password present",
      "ota.esphome",
      "ota:\n  - platform: esphome\n    password: x\n",
      2,
      true,
    ],
    ["ota: absent", "ota.esphome", "ota:\n  - platform: esphome\n", 2, false],
    [
      "ota: a sibling platform has a password, this one doesn't",
      "ota.esphome",
      "ota:\n  - platform: esphome\n    id: x\n  - platform: http_request\n    password: y\n",
      2,
      false,
    ],
    [
      "web_server: auth present",
      "web_server",
      "web_server:\n  port: 80\n  auth:\n    username: a\n",
      1,
      true,
    ],
    ["web_server: absent", "web_server", "web_server:\n  port: 80\n", 1, false],
  ];
  for (const [name, sk, yaml, fromLine, present] of cases) {
    it(`_markerPresent: ${name}`, () => {
      expect(make(sk, yaml, fromLine).inner._markerPresent()).toBe(present);
    });
  }

  it("returns nothing for a non-security section", () => {
    const { inner } = make("sensor", "sensor:\n  - platform: dht\n", 1);
    expect(inner._setting).toBeUndefined();
    expect(inner._markerPresent()).toBe(false);
  });

  it("does not resolve an inherited key like __proto__ to a setting", () => {
    const { inner } = make("__proto__", "__proto__:\n  foo: bar\n", 1);
    expect(inner._setting).toBeUndefined();
    expect(inner._markerPresent()).toBe(false);
  });
});

describe("security-notice — render", () => {
  it("renders the notice + CTA when the marker is absent", async () => {
    const { el } = await mount("api", "api:\n  id: api_server\n", 1, [
      { name: "kitchen" },
    ]);
    expect(el.shadowRoot!.querySelector(".notice")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".cta")).not.toBeNull();
  });

  it("renders nothing when the marker is present", async () => {
    const { el } = await mount("api", "api:\n  encryption:\n    key: abc\n", 1, [
      { name: "kitchen" },
    ]);
    expect(el.shadowRoot!.querySelector(".notice")).toBeNull();
  });

  it("disables the CTA until the device name resolves", async () => {
    const { el, inner } = await mount("api", "api:\n  id: api_server\n", 1); // no devices
    expect(el.shadowRoot!.querySelector<HTMLButtonElement>(".cta")!.disabled).toBe(true);
    inner._devices = [{ name: "kitchen", configuration: "device.yaml" }];
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector<HTMLButtonElement>(".cta")!.disabled).toBe(false);
  });

  it("shows only secret-field keys as <code> in the dialog body (web password, not the inline username)", async () => {
    const { el } = await mount("web_server", "web_server:\n  port: 80\n", 1, [
      { name: "kitchen" },
    ]);
    const codes = Array.from(el.shadowRoot!.querySelectorAll(".dialog-body code")).map(
      (c) => c.textContent
    );
    expect(codes).toEqual(["kitchen__web_password"]);
  });
});

describe("security-notice — generate", () => {
  function setup(
    sectionKey: string,
    yaml: string,
    fromLine: number,
    setSecretImpl: (
      key: string,
      value: string,
      overwrite: boolean
    ) => Promise<{ created: boolean }> = async () => ({ created: true }),
    devices = [{ name: "kitchen" }]
  ) {
    const setSecret = vi.fn(setSecretImpl);
    const { el, inner } = make(sectionKey, yaml, fromLine);
    inner._api = { setSecret } as Partial<ESPHomeAPI>;
    inner._devices = devices.map((d) => ({ ...d, configuration: "device.yaml" }));
    const applied: { path: string[]; value: string }[][] = [];
    el.addEventListener("apply-section-values", (e) =>
      applied.push((e as CustomEvent).detail.changes)
    );
    return { el, inner, setSecret, applied };
  }

  it("api: writes the encryption key and references encryption.key", async () => {
    const { inner, setSecret, applied } = setup("api", "api:\n  id: api_server\n", 1);
    await inner._onGenerate();
    const [key, value, overwrite] = setSecret.mock.calls[0];
    expect(key).toBe("kitchen__encryption_key");
    expect(value).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(overwrite).toBe(false); // create-if-absent
    expect(applied[0]).toEqual([
      { path: ["encryption", "key"], value: "!secret kitchen__encryption_key" },
    ]);
  });

  it("ota: writes a passphrase and references password", async () => {
    const { inner, setSecret, applied } = setup(
      "ota.esphome",
      "ota:\n  - platform: esphome\n",
      2
    );
    await inner._onGenerate();
    const [key, value] = setSecret.mock.calls[0];
    expect(key).toBe("kitchen__ota_password");
    expect(value).toMatch(/^[a-z]+(-[a-z]+){3}$/);
    expect(applied[0]).toEqual([
      { path: ["password"], value: "!secret kitchen__ota_password" },
    ]);
  });

  it("web_server: inlines a single-word username, stores only the password", async () => {
    const { inner, setSecret, applied } = setup(
      "web_server",
      "web_server:\n  port: 80\n",
      1
    );
    await inner._onGenerate();
    // Only the password is written to secrets.yaml (username is inline).
    expect(setSecret).toHaveBeenCalledTimes(1);
    const [key, value] = setSecret.mock.calls[0];
    expect(key).toBe("kitchen__web_password");
    expect(value).toMatch(/^[a-z]+(-[a-z]+){3}$/);

    const [user, pass] = applied[0];
    expect(user.path).toEqual(["auth", "username"]);
    expect(user.value).toMatch(/^[a-z]+$/); // single inline word, not a !secret ref
    expect(pass).toEqual({
      path: ["auth", "password"],
      value: "!secret kitchen__web_password",
    });
  });

  it("reuses an existing secret (no overwrite) and still references it", async () => {
    const { inner, setSecret, applied } = setup(
      "ota.esphome",
      "ota:\n  - platform: esphome\n",
      2,
      async () => ({ created: false }) // key already present → reused, not overwritten
    );
    await inner._onGenerate();
    // The write is create-if-absent, so the existing value is left intact server-side.
    expect(setSecret).toHaveBeenCalledWith(
      "kitchen__ota_password",
      expect.any(String),
      false
    );
    expect(applied[0]).toEqual([
      { path: ["password"], value: "!secret kitchen__ota_password" },
    ]);
    expect(toast.success).toHaveBeenCalled();
  });

  it("does nothing when the device name can't resolve", async () => {
    const { inner, setSecret } = setup(
      "api",
      "api:\n  id: api_server\n",
      1,
      async () => ({ created: true }),
      []
    );
    await inner._onGenerate();
    expect(setSecret).not.toHaveBeenCalled();
  });

  it("aborts on a secrets write failure without emitting", async () => {
    const { inner, applied } = setup("api", "api:\n  id: api_server\n", 1, async () => {
      throw new Error("ws blip");
    });
    await inner._onGenerate();
    expect(applied).toHaveLength(0);
    expect(toast.error).toHaveBeenCalled();
  });
});
