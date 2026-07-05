/**
 * @vitest-environment happy-dom
 *
 * The per-key writers delegate to the atomic ``config/set_secret`` command
 * (issue #1334); the line-based YAML manipulation now lives on the backend.
 * These pin the call contract: ensure passes ``overwrite=false`` and only
 * announces ``secrets-saved`` when the backend reports a create, set passes
 * ``overwrite=true`` and always announces.
 */
import { describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/esphome-api.js";
import { ensureSecretInYaml, setSecretInYaml } from "../../src/util/secrets-write.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

function apiWith(created: boolean) {
  return {
    setSecret: vi.fn(async () => ({ created })),
  } as unknown as ESPHomeAPI;
}

describe("ensureSecretInYaml", () => {
  it("calls config/set_secret with overwrite=false and announces a create", async () => {
    const api = apiWith(true);
    const saved = vi.fn();
    window.addEventListener("secrets-saved", saved as EventListener);

    const result = await ensureSecretInYaml(api, "kitchen__encryption_key", "oQ3==");

    expect(result).toEqual({ created: true });
    expect(api.setSecret).toHaveBeenCalledWith("kitchen__encryption_key", "oQ3==", false);
    await tick();
    expect(saved).toHaveBeenCalled();
    window.removeEventListener("secrets-saved", saved as EventListener);
  });

  it("does not announce secrets-saved when the key already existed", async () => {
    const api = apiWith(false);
    const saved = vi.fn();
    window.addEventListener("secrets-saved", saved as EventListener);

    const result = await ensureSecretInYaml(api, "kitchen__encryption_key", "new");

    expect(result).toEqual({ created: false });
    await tick();
    expect(saved).not.toHaveBeenCalled();
    window.removeEventListener("secrets-saved", saved as EventListener);
  });

  it("rejects when the command rejects", async () => {
    const api = {
      setSecret: vi.fn(async () => {
        throw new Error("ws blip");
      }),
    } as unknown as ESPHomeAPI;

    await expect(ensureSecretInYaml(api, "k", "v")).rejects.toThrow();
  });
});

describe("setSecretInYaml", () => {
  it("calls config/set_secret with overwrite=true and announces secrets-saved", async () => {
    const api = apiWith(false);
    const saved = vi.fn();
    window.addEventListener("secrets-saved", saved as EventListener);

    await setSecretInYaml(api, "kitchen__encryption_key", "new");

    expect(api.setSecret).toHaveBeenCalledWith("kitchen__encryption_key", "new", true);
    await tick();
    expect(saved).toHaveBeenCalled();
    window.removeEventListener("secrets-saved", saved as EventListener);
  });
});
