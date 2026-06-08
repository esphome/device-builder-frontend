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
import { ensureSecretWithToast } from "../../src/util/ensure-secret-with-toast.js";

const localize = ((key: string) => key) as (key: string, args?: unknown) => string;
const messages = {
  createdKey: "device.created",
  errorKey: "device.error",
  logLabel: "create failed",
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
});

describe("ensureSecretWithToast", () => {
  it("appends a new key, toasts success, and returns true", async () => {
    const api = {
      getConfig: vi.fn(async () => "other: x\n"),
      updateConfig: vi.fn(async () => {}),
    } as unknown as ESPHomeAPI;

    const ok = await ensureSecretWithToast(api, "k", "v", localize, messages);

    expect(ok).toBe(true);
    const [, content] = (api.updateConfig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toContain("k: v");
    expect(toast.success).toHaveBeenCalledWith("device.created", { richColors: true });
  });

  it("links to an existing key (no write) and toasts info", async () => {
    const api = {
      getConfig: vi.fn(async () => "k: existing\n"),
      updateConfig: vi.fn(async () => {}),
    } as unknown as ESPHomeAPI;

    const ok = await ensureSecretWithToast(api, "k", "v", localize, messages);

    expect(ok).toBe(true);
    expect(api.updateConfig).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("device.secret_picker_linked", {
      richColors: true,
    });
  });

  it("toasts an error and returns false when the read fails", async () => {
    const api = {
      getConfig: vi.fn(async () => {
        throw new Error("ws blip");
      }),
      updateConfig: vi.fn(async () => {}),
    } as unknown as ESPHomeAPI;

    const ok = await ensureSecretWithToast(api, "k", "v", localize, messages);

    expect(ok).toBe(false);
    expect(api.updateConfig).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("device.error", { richColors: true });
  });
});
