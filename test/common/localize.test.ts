import { describe, expect, it } from "vitest";
import { defaultLocalize } from "../../src/common/localize.js";

describe("defaultLocalize", () => {
  it("resolves a top-level string key", () => {
    expect(defaultLocalize("dashboard.title")).toBe("ESPHome - Device Builder");
  });

  it("resolves a deeply nested key", () => {
    expect(defaultLocalize("wizard.tag.esp32")).toBe("ESP32");
  });

  it("returns the key unchanged when missing", () => {
    expect(defaultLocalize("does.not.exist")).toBe("does.not.exist");
  });

  it("returns the key unchanged when traversal hits a string mid-path", () => {
    expect(defaultLocalize("dashboard.title.sub")).toBe("dashboard.title.sub");
  });

  it("returns the key unchanged when the resolved value is not a string", () => {
    expect(defaultLocalize("wizard.tag")).toBe("wizard.tag");
  });

  it("interpolates {variable} placeholders", () => {
    const out = defaultLocalize("dashboard.discovered_count_plural", {
      count: 3,
    });
    expect(out).toBe("Discovered 3 devices");
  });

  it("interpolates multiple placeholders", () => {
    const out = defaultLocalize("dashboard.pagination_page_of", {
      current: 2,
      total: 7,
    });
    expect(out).toBe("Page 2 of 7");
  });

  it("leaves unknown placeholders intact", () => {
    const out = defaultLocalize("dashboard.discovered_count_singular", {});
    expect(out).toBe("Discovered {count} device");
  });

  it("coerces numeric values to strings", () => {
    const out = defaultLocalize("dashboard.update_selected", { count: 5 });
    expect(out).toBe("Update 5 device(s)");
  });
});
