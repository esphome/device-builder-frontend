/**
 * @vitest-environment happy-dom
 *
 * Pins the API-encryption nudge: detecting a missing `encryption:` *direct
 * child* (but not a keyless one, nor a deeper-nested one), and the generate
 * flow that writes secrets.yaml + emits `apply-encryption-key`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
// The confirm dialog pulls in wa-button, which doesn't mount under happy-dom;
// the notice + dialog body markup we assert on are the sub-component's own.
vi.mock("../../../src/components/confirm-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import toast from "sonner-js";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import { ESPHomeApiEncryptionNotice } from "../../../src/components/device/api-encryption-notice.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
function make(yaml: string) {
  const el = new ESPHomeApiEncryptionNotice();
  const inner = el as any;
  inner.yaml = yaml;
  inner.configuration = "device.yaml";
  return { el, inner };
}

/** Mount with optional device so the secret key resolves. */
async function mount(yaml: string, devices: { name: string }[] = []) {
  const { el, inner } = make(yaml);
  inner._devices = devices.map((d) => ({ ...d, configuration: "device.yaml" }));
  document.body.appendChild(el);
  await el.updateComplete;
  return { el, inner };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("api-encryption-notice — detection", () => {
  const cases: Array<[string, string, boolean]> = [
    ["key present", "api:\n  encryption:\n    key: abc\n", true],
    ["keyless block (HA auto-provisions)", "api:\n  encryption:\n", true],
    ["no encryption", "api:\n  id: api_server\n", false],
    ["bodyless api", "api:\n", false],
    [
      "deeper-nested encryption (not a direct child)",
      "api:\n  actions:\n    - action: x\n      variables:\n        encryption: y\n",
      false,
    ],
    [
      "encryption under a later sibling",
      "api:\n  id: x\nwifi:\n  encryption: y\n",
      false,
    ],
  ];
  for (const [name, yaml, present] of cases) {
    it(`_encryptionLinePresent: ${name}`, () => {
      expect(make(yaml).inner._encryptionLinePresent()).toBe(present);
    });
  }
});

describe("api-encryption-notice — render", () => {
  it("renders the notice + CTA when encryption is absent", async () => {
    const { el } = await mount("api:\n  id: api_server\n", [{ name: "kitchen" }]);
    expect(el.shadowRoot!.querySelector(".notice")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".cta")).not.toBeNull();
  });

  it("renders nothing when encryption is present", async () => {
    const { el } = await mount("api:\n  encryption:\n    key: abc\n", [
      { name: "kitchen" },
    ]);
    expect(el.shadowRoot!.querySelector(".notice")).toBeNull();
  });

  it("disables the CTA until the device name resolves", async () => {
    const { el, inner } = await mount("api:\n  id: api_server\n"); // no devices
    const cta = el.shadowRoot!.querySelector<HTMLButtonElement>(".cta")!;
    expect(cta.disabled).toBe(true);

    inner._devices = [{ name: "kitchen", configuration: "device.yaml" }];
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector<HTMLButtonElement>(".cta")!.disabled).toBe(false);
  });

  it("renders the secret key as a <code> element in the dialog body", async () => {
    const { el } = await mount("api:\n  id: api_server\n", [{ name: "kitchen" }]);
    const code = el.shadowRoot!.querySelector(".dialog-body code");
    expect(code?.textContent).toBe("kitchen__encryption_key");
  });

  it("_onCta opens the dialog only when a secret key is available", async () => {
    const { el, inner } = await mount("api:\n  id: api_server\n"); // no device → no key
    const dialog = el.shadowRoot!.querySelector("esphome-confirm-dialog")! as any;
    dialog.open = vi.fn();

    inner._onCta();
    expect(dialog.open).not.toHaveBeenCalled();

    inner._devices = [{ name: "kitchen", configuration: "device.yaml" }];
    inner._onCta();
    expect(dialog.open).toHaveBeenCalledTimes(1);
  });
});

describe("api-encryption-notice — generate", () => {
  function setup(getConfig: () => Promise<string>, devices = [{ name: "kitchen" }]) {
    const updateConfig = vi.fn().mockResolvedValue(undefined);
    const { el, inner } = make("api:\n  id: api_server\n");
    inner._api = { getConfig: vi.fn(getConfig), updateConfig } as Partial<ESPHomeAPI>;
    inner._devices = devices.map((d) => ({ ...d, configuration: "device.yaml" }));
    return { el, inner, updateConfig };
  }

  it("resolves no secret key (so the CTA is disabled) without a device", () => {
    const { inner } = setup(async () => "", []);
    expect(inner._secretKey).toBe("");
  });

  it("writes secrets.yaml and emits apply-encryption-key", async () => {
    const { el, inner, updateConfig } = setup(async () => "wifi_ssid: x\n");
    const applied: string[] = [];
    el.addEventListener("apply-encryption-key", (e) =>
      applied.push((e as CustomEvent).detail.secretKey as string)
    );

    await inner._onGenerate();

    const [file, content] = updateConfig.mock.calls[0];
    expect(file).toBe("secrets.yaml");
    expect(content).toMatch(/kitchen__encryption_key: [A-Za-z0-9+/]{43}=/);
    expect(applied).toEqual(["kitchen__encryption_key"]);
    expect(toast.success).toHaveBeenCalled();
  });

  it("links to the existing key (no overwrite) when it already exists", async () => {
    const { el, inner, updateConfig } = setup(
      async () => "kitchen__encryption_key: existing\n"
    );
    const applied: string[] = [];
    el.addEventListener("apply-encryption-key", (e) =>
      applied.push((e as CustomEvent).detail.secretKey as string)
    );

    await inner._onGenerate();

    // Reused, not overwritten, but still referenced from the config.
    expect(updateConfig).not.toHaveBeenCalled();
    expect(applied).toEqual(["kitchen__encryption_key"]);
    expect(toast.success).toHaveBeenCalled();
  });

  it("does nothing when the device name can't resolve", async () => {
    const { inner, updateConfig } = setup(async () => "", []);
    await inner._onGenerate();
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("aborts on a secrets read failure without emitting", async () => {
    const { el, inner, updateConfig } = setup(async () => {
      throw new Error("ws blip");
    });
    const applied = vi.fn();
    el.addEventListener("apply-encryption-key", applied);

    await inner._onGenerate();

    expect(updateConfig).not.toHaveBeenCalled();
    expect(applied).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});
