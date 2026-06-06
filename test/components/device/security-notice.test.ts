/**
 * @vitest-environment happy-dom
 *
 * Pins the generalized security nudge across its three settings: detecting a
 * missing marker (api `encryption:`, ota `password:`, web_server `auth:`) and
 * the generate flow that writes secrets.yaml + emits `apply-security-secrets`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
  document.body.innerHTML = "";
});

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
    getConfig: () => Promise<string>,
    devices = [{ name: "kitchen" }]
  ) {
    const updateConfig = vi.fn().mockResolvedValue(undefined);
    const { el, inner } = make(sectionKey, yaml, fromLine);
    inner._api = { getConfig: vi.fn(getConfig), updateConfig } as Partial<ESPHomeAPI>;
    inner._devices = devices.map((d) => ({ ...d, configuration: "device.yaml" }));
    const applied: { path: string[]; value: string }[][] = [];
    el.addEventListener("apply-security-secrets", (e) =>
      applied.push((e as CustomEvent).detail.secrets)
    );
    return { el, inner, updateConfig, applied };
  }

  it("api: writes the encryption key and references encryption.key", async () => {
    const { inner, updateConfig, applied } = setup(
      "api",
      "api:\n  id: api_server\n",
      1,
      async () => "wifi_ssid: x\n"
    );
    await inner._onGenerate();
    const [file, content] = updateConfig.mock.calls[0];
    expect(file).toBe("secrets.yaml");
    expect(content).toMatch(/kitchen__encryption_key: [A-Za-z0-9+/]{43}=/);
    expect(applied[0]).toEqual([
      { path: ["encryption", "key"], value: "!secret kitchen__encryption_key" },
    ]);
  });

  it("ota: writes a passphrase and references password", async () => {
    const { inner, updateConfig, applied } = setup(
      "ota.esphome",
      "ota:\n  - platform: esphome\n",
      2,
      async () => ""
    );
    await inner._onGenerate();
    const [, content] = updateConfig.mock.calls[0];
    expect(content).toMatch(/kitchen__ota_password: [a-z]+(-[a-z]+){3}\n/);
    expect(applied[0]).toEqual([
      { path: ["password"], value: "!secret kitchen__ota_password" },
    ]);
  });

  it("web_server: inlines a single-word username, stores only the password", async () => {
    const { inner, updateConfig, applied } = setup(
      "web_server",
      "web_server:\n  port: 80\n",
      1,
      async () => ""
    );
    await inner._onGenerate();
    // Only the password is written to secrets.yaml (username is inline).
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(updateConfig.mock.calls[0][1]).toMatch(
      /kitchen__web_password: [a-z]+(-[a-z]+){3}\n/
    );
    expect(updateConfig.mock.calls[0][1]).not.toContain("web_username");

    const [user, pass] = applied[0];
    expect(user.path).toEqual(["auth", "username"]);
    expect(user.value).toMatch(/^[a-z]+$/); // single inline word, not a !secret ref
    expect(pass).toEqual({
      path: ["auth", "password"],
      value: "!secret kitchen__web_password",
    });
  });

  it("reuses an existing secret (no overwrite) and still references it", async () => {
    const { inner, updateConfig, applied } = setup(
      "ota.esphome",
      "ota:\n  - platform: esphome\n",
      2,
      async () => "kitchen__ota_password: existing\n" // key already present → reused
    );
    await inner._onGenerate();
    expect(updateConfig).not.toHaveBeenCalled();
    expect(applied[0]).toEqual([
      { path: ["password"], value: "!secret kitchen__ota_password" },
    ]);
    expect(toast.success).toHaveBeenCalled();
  });

  it("does nothing when the device name can't resolve", async () => {
    const { inner, updateConfig } = setup(
      "api",
      "api:\n  id: api_server\n",
      1,
      async () => "",
      []
    );
    await inner._onGenerate();
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("aborts on a secrets read failure without emitting", async () => {
    const { inner, updateConfig, applied } = setup(
      "api",
      "api:\n  id: api_server\n",
      1,
      async () => {
        throw new Error("ws blip");
      }
    );
    await inner._onGenerate();
    expect(updateConfig).not.toHaveBeenCalled();
    expect(applied).toHaveLength(0);
    expect(toast.error).toHaveBeenCalled();
  });
});
