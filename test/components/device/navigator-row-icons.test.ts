import { describe, expect, it, vi } from "vitest";

// Loading the module registers an mdi resolver as a side effect; stub the
// webawesome registry so the import doesn't pull the real icon library.
vi.mock("@home-assistant/webawesome/dist/components/icon/library.js", () => ({
  registerIconLibrary: vi.fn(),
}));

import { iconForDomain } from "../../../src/components/device/navigator-row-icons.js";

describe("iconForDomain", () => {
  it("maps known domains to their glyph", () => {
    expect(iconForDomain("sensor")).toBe("gauge");
    expect(iconForDomain("switch")).toBe("toggle-switch-outline");
    expect(iconForDomain("number")).toBe("numeric");
  });

  it("shares one glyph across related domains", () => {
    expect(iconForDomain("mdns")).toBe(iconForDomain("ethernet"));
  });

  it("falls back to a neutral shape for unmapped domains", () => {
    expect(iconForDomain("totally_unknown")).toBe("shape-outline");
  });
});
