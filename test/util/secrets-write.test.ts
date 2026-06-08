/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/esphome-api.js";
import { ensureSecretInYaml, setSecretInYaml } from "../../src/util/secrets-write.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ensureSecretInYaml", () => {
  it("appends a new key and dispatches secrets-saved", async () => {
    const api = {
      getConfig: vi.fn(async () => "wifi_ssid: x\n"),
      updateConfig: vi.fn(async () => {}),
    } as unknown as ESPHomeAPI;
    const saved = vi.fn();
    window.addEventListener("secrets-saved", saved as EventListener);

    const result = await ensureSecretInYaml(api, "kitchen__encryption_key", "oQ3==");

    expect(result).toEqual({ created: true });
    const [file, content] = (api.updateConfig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(file).toBe("secrets.yaml");
    expect(content).toContain("wifi_ssid: x");
    expect(content).toContain("kitchen__encryption_key: oQ3==");
    await tick();
    expect(saved).toHaveBeenCalled();
    window.removeEventListener("secrets-saved", saved as EventListener);
  });

  it("leaves an existing key untouched and writes nothing", async () => {
    const api = {
      getConfig: vi.fn(async () => "kitchen__encryption_key: existing\n"),
      updateConfig: vi.fn(async () => {}),
    } as unknown as ESPHomeAPI;

    const result = await ensureSecretInYaml(api, "kitchen__encryption_key", "new");

    expect(result).toEqual({ created: false });
    expect(api.updateConfig).not.toHaveBeenCalled();
  });

  it("rejects and never writes when the read fails", async () => {
    const api = {
      getConfig: vi.fn(async () => {
        throw new Error("ws blip");
      }),
      updateConfig: vi.fn(async () => {}),
    } as unknown as ESPHomeAPI;

    await expect(ensureSecretInYaml(api, "k", "v")).rejects.toThrow();
    expect(api.updateConfig).not.toHaveBeenCalled();
  });

  it("quotes a value that needs quoting via formatYamlScalar", async () => {
    const api = {
      getConfig: vi.fn(async () => ""),
      updateConfig: vi.fn(async () => {}),
    } as unknown as ESPHomeAPI;

    await ensureSecretInYaml(api, "k", "a: b # c");

    const [, content] = (api.updateConfig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toBe('k: "a: b # c"\n');
  });
});

describe("setSecretInYaml", () => {
  it("overwrites an existing key's value, preserving other secrets", async () => {
    const api = {
      getConfig: vi.fn(async () => "a: 1\nkitchen__encryption_key: old\nb: 2\n"),
      updateConfig: vi.fn(async () => {}),
    } as unknown as ESPHomeAPI;
    const saved = vi.fn();
    window.addEventListener("secrets-saved", saved as EventListener);

    await setSecretInYaml(api, "kitchen__encryption_key", "new");

    const [, content] = (api.updateConfig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toContain("kitchen__encryption_key: new");
    expect(content).not.toContain("old");
    expect(content).toContain("a: 1");
    expect(content).toContain("b: 2");
    await tick();
    expect(saved).toHaveBeenCalled();
    window.removeEventListener("secrets-saved", saved as EventListener);
  });

  it("preserves an inline comment on the rewritten line", async () => {
    const api = {
      getConfig: vi.fn(async () => "k: old  # keep me\n"),
      updateConfig: vi.fn(async () => {}),
    } as unknown as ESPHomeAPI;

    await setSecretInYaml(api, "k", "new");

    const [, content] = (api.updateConfig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toBe("k: new  # keep me\n");
  });

  it("appends when the key is absent", async () => {
    const api = {
      getConfig: vi.fn(async () => "other: x\n"),
      updateConfig: vi.fn(async () => {}),
    } as unknown as ESPHomeAPI;

    await setSecretInYaml(api, "k", "v");

    const [, content] = (api.updateConfig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toContain("other: x");
    expect(content).toContain("k: v");
  });
});
