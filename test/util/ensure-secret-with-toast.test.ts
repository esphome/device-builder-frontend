/**
 * @vitest-environment happy-dom
 *
 * Pins ensureSecretWithToast: created → success toast + createdKey, existing →
 * info toast + the shared "linked" key, failure → error toast + false return.
 * The write goes through the atomic ``config/set_secret`` command (issue #1334).
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
import { identityLocalize } from "../_dom.js";

const localize = identityLocalize as (key: string, args?: unknown) => string;
const messages = {
  createdKey: "device.created",
  errorKey: "device.error",
  logLabel: "create failed",
};
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Stub API whose ``setSecret`` reports the given create/overwrite outcome. */
function apiWith(created: boolean, keys: string[]) {
  return {
    setSecret: vi.fn(async () => ({ created })),
    getSecretKeys: vi.fn(async () => keys),
  } as unknown as ESPHomeAPI;
}

afterEach(() => {
  _resetSecretKeysCache();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
});

describe("ensureSecretWithToast", () => {
  it("creates a new key, toasts success, refreshes the cache, and returns true", async () => {
    const api = apiWith(true, ["other", "k"]);

    const ok = await ensureSecretWithToast(api, "k", "v", localize, messages);
    await flush();

    expect(ok).toBe(true);
    expect(api.setSecret).toHaveBeenCalledWith("k", "v", false);
    expect(toast.success).toHaveBeenCalledWith("device.created", { richColors: true });
    expect(api.getSecretKeys).toHaveBeenCalled();
  });

  it("links to an existing key, toasts info, and still refreshes the cache", async () => {
    const api = apiWith(false, ["k"]);

    const ok = await ensureSecretWithToast(api, "k", "v", localize, messages);
    await flush();

    expect(ok).toBe(true);
    expect(toast.info).toHaveBeenCalledWith("device.secret_picker_linked", {
      richColors: true,
    });
    expect(api.getSecretKeys).toHaveBeenCalled();
  });

  it("toasts an error, returns false, and skips the refresh when the write fails", async () => {
    const api = {
      setSecret: vi.fn(async () => {
        throw new Error("ws blip");
      }),
      getSecretKeys: vi.fn(async () => []),
    } as unknown as ESPHomeAPI;

    const ok = await ensureSecretWithToast(api, "k", "v", localize, messages);
    await flush();

    expect(ok).toBe(false);
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
    const api = apiWith(false, ["k"]);

    const ok = await setSecretWithToast(api, "k", "new", localize, setMessages);
    await flush();

    expect(ok).toBe(true);
    expect(api.setSecret).toHaveBeenCalledWith("k", "new", true);
    expect(toast.success).toHaveBeenCalledWith("device.saved", { richColors: true });
    expect(api.getSecretKeys).toHaveBeenCalled();
  });

  it("toasts an error, returns false, and skips the refresh on failure", async () => {
    const api = {
      setSecret: vi.fn(async () => {
        throw new Error("ws blip");
      }),
      getSecretKeys: vi.fn(async () => []),
    } as unknown as ESPHomeAPI;

    const ok = await setSecretWithToast(api, "k", "new", localize, setMessages);
    await flush();

    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("device.error", { richColors: true });
    expect(api.getSecretKeys).not.toHaveBeenCalled();
  });
});
