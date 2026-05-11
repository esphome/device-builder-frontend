import { describe, expect, it } from "vitest";
import { classifyVersionMismatch } from "../../src/util/version-mismatch.js";

describe("classifyVersionMismatch", () => {
  it("returns null when versions match exactly", () => {
    expect(classifyVersionMismatch("2026.5.0", "2026.5.0")).toBeNull();
  });

  it("returns null when either side is empty (handshake not yet complete)", () => {
    expect(classifyVersionMismatch("", "2026.5.0")).toBeNull();
    expect(classifyVersionMismatch("2026.5.0", "")).toBeNull();
    expect(classifyVersionMismatch("", "")).toBeNull();
  });

  it("classifies patch-level differences", () => {
    expect(classifyVersionMismatch("2026.5.0", "2026.5.1")).toBe("patch");
    expect(classifyVersionMismatch("2026.5.1", "2026.5.0")).toBe("patch");
  });

  it("classifies suffix-only differences (beta / dev) as patch-level", () => {
    expect(classifyVersionMismatch("2026.5.0", "2026.5.0b1")).toBe("patch");
    expect(classifyVersionMismatch("2026.5.0", "2026.5.0-dev")).toBe("patch");
  });

  it("classifies year+month differences as release-level", () => {
    expect(classifyVersionMismatch("2026.5.0", "2026.4.0")).toBe("release");
    expect(classifyVersionMismatch("2026.5.0", "2026.6.0")).toBe("release");
    expect(classifyVersionMismatch("2026.12.0", "2027.1.0")).toBe("release");
  });

  it("classifies cross-year differences as release-level", () => {
    expect(classifyVersionMismatch("2026.5.0", "2025.12.0")).toBe("release");
  });

  it("treats beta receiver against stable offloader as patch when same release", () => {
    // Receiver might be running a beta build the offloader hasn't
    // moved to yet; the YAML schemas are typically compatible at
    // that point so the operator should see this as patch-level,
    // not release-level.
    expect(classifyVersionMismatch("2026.5.0", "2026.5.0b3")).toBe("patch");
  });
});
