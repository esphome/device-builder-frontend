import { describe, expect, it } from "vitest";

const loadGuard = async () => {
  return (await import("../../build-scripts/only-pnpm.cjs")) as {
    isAllowed: (userAgent?: string) => boolean;
    detectedManager: (userAgent?: string) => string;
    message: (userAgent?: string) => string;
  };
};

describe("only-pnpm preinstall guard", () => {
  it("allows pnpm installs", async () => {
    const { isAllowed } = await loadGuard();
    expect(isAllowed("pnpm/10.33.4 npm/? node/v24.0.0 linux x64")).toBe(true);
  });

  it("rejects yarn installs", async () => {
    const { isAllowed } = await loadGuard();
    expect(isAllowed("yarn/1.22.22 npm/? node/v22.18.0 linux x64")).toBe(false);
  });

  it("rejects npm installs", async () => {
    const { isAllowed } = await loadGuard();
    expect(isAllowed("npm/11.13.0 node/v22.18.0 linux x64")).toBe(false);
  });

  it("allows installs with no detectable user-agent", async () => {
    const { isAllowed } = await loadGuard();
    expect(isAllowed(undefined)).toBe(true);
    expect(isAllowed("")).toBe(true);
  });

  it("names the detected manager in the failure message", async () => {
    const { message } = await loadGuard();
    expect(message("yarn/1.22.22 npm/? node/v22.18.0")).toContain("yarn");
    expect(message("yarn/1.22.22 npm/? node/v22.18.0")).toContain("pnpm install");
  });
});
