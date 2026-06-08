/**
 * @vitest-environment happy-dom
 *
 * Pins ensureSecretWithToast: created → success toast + createdKey, existing →
 * info toast + the shared "linked" key, failure → error toast + false return.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import toast from "sonner-js";
import type { ESPHomeAPI } from "../../src/api/esphome-api.js";
import {
  ensureSecretWithToast,
  setSecretWithToast,
} from "../../src/util/ensure-secret-with-toast.js";
import { _resetSecretKeysCache } from "../../src/util/secrets-cache.js";

const localize = ((key: string) => key) as (key: string, args?: unknown) => string;
const messages = {
  createdKey: "device.created",
  errorKey: "device.error",
  logLabel: "create failed",
};
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  document.body.innerHTML = "";
  _resetSecretKeysCache();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
});

describe("ensureSecretWithToast", () => {
  it("appends a new key, toasts success, refreshes the cache, and returns true", async () => {
    const api = {
      getConfig: vi.fn(async () => "other: x\n"),
      updateConfig: vi.fn(async () => {}),
      getSecretKeys: vi.fn(async () => ["other", "k"]),
    } as unknown as ESPHomeAPI;

    const ok = await ensureSecretWithToast(api, "k", "v", localize, messages);
    await flush();

    expect(ok).toBe(true);
    const [, content] = (api.updateConfig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toContain("k: v");
    expect(toast.success).toHaveBeenCalledWith("device.created", { richColors: true });
    expect(api.getSecretKeys).toHaveBeenCalled();
  });

  it("links to an existing key (no write), toasts info, and still refreshes the cache", async () => {
    const api = {
      getConfig: vi.fn(async () => "k: existing\n"),
      updateConfig: vi.fn(async () => {}),
      getSecretKeys: vi.fn(async () => ["k"]),
    } as unknown as ESPHomeAPI;

    const ok = await ensureSecretWithToast(api, "k", "v", localize, messages);
    await flush();

    expect(ok).toBe(true);
    expect(api.updateConfig).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("device.secret_picker_linked", {
      richColors: true,
    });
    // The linked path doesn't fire secrets-saved, so the cache is refreshed here.
    expect(api.getSecretKeys).toHaveBeenCalled();
  });

  it("toasts an error, returns false, and skips the refresh when the read fails", async () => {
    const api = {
      getConfig: vi.fn(async () => {
        throw new Error("ws blip");
      }),
      updateConfig: vi.fn(async () => {}),
      getSecretKeys: vi.fn(async () => []),
    } as unknown as ESPHomeAPI;

    const ok = await ensureSecretWithToast(api, "k", "v", localize, messages);
    await flush();

    expect(ok).toBe(false);
    expect(api.updateConfig).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("device.error", { richColors: true });
    expect(api.getSecretKeys).not.toHaveBeenCalled();
  });
});

describe("setSecretWithToast", () => {
  const setMessages = {
    savedKey: "device.saved",
    errorKey: "device.error",
    logLabel: "save failed",
  };

  it("overwrites the value, toasts success, and refreshes the cache", async () => {
    const api = {
      getConfig: vi.fn(async () => "k: old\n"),
      updateConfig: vi.fn(async () => {}),
      getSecretKeys: vi.fn(async () => ["k"]),
    } as unknown as ESPHomeAPI;

    const ok = await setSecretWithToast(api, "k", "new", localize, setMessages);
    await flush();

    expect(ok).toBe(true);
    const [, content] = (api.updateConfig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toContain("k: new");
    expect(toast.success).toHaveBeenCalledWith("device.saved", { richColors: true });
    expect(api.getSecretKeys).toHaveBeenCalled();
  });

  it("toasts an error, returns false, and skips the refresh on failure", async () => {
    const api = {
      getConfig: vi.fn(async () => {
        throw new Error("ws blip");
      }),
      updateConfig: vi.fn(async () => {}),
      getSecretKeys: vi.fn(async () => []),
    } as unknown as ESPHomeAPI;

    const ok = await setSecretWithToast(api, "k", "new", localize, setMessages);
    await flush();

    expect(ok).toBe(false);
    expect(api.updateConfig).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("device.error", { richColors: true });
    expect(api.getSecretKeys).not.toHaveBeenCalled();
  });
});
