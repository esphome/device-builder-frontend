import { describe, expect, it, vi } from "vitest";
import { APIError } from "../../src/api/api-error.js";
import type { ESPHomeAPI } from "../../src/api/index.js";
import { captureMaskedConfig } from "../../src/util/masked-config-capture.js";

const api = (getConfig: ReturnType<typeof vi.fn>): ESPHomeAPI =>
  ({ ready: Promise.resolve(), getConfig }) as unknown as ESPHomeAPI;

describe("captureMaskedConfig", () => {
  it("masks the read YAML", async () => {
    const getConfig = vi.fn().mockResolvedValue("wifi:\n  password: hunter2");
    const masked = await captureMaskedConfig(api(getConfig), "a.yaml", () => false);
    expect(masked).not.toContain("hunter2");
    expect(masked).toContain("password: •");
  });

  it('resolves "" when the read fails', async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const getConfig = vi.fn().mockRejectedValue(new APIError("not_found", "gone"));
    expect(await captureMaskedConfig(api(getConfig), "a.yaml", () => false)).toBe("");
    vi.restoreAllMocks();
  });

  it("resolves null once abandoned", async () => {
    let abandoned = false;
    let settle!: (v: string) => void;
    const getConfig = vi.fn(() => new Promise<string>((r) => (settle = r)));
    const result = captureMaskedConfig(api(getConfig), "a.yaml", () => abandoned);
    await Promise.resolve();
    abandoned = true;
    settle("wifi:\n  password: hunter2");
    expect(await result).toBeNull();
  });
});
