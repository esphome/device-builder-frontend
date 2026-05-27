import { describe, expect, it } from "vitest";
import { normalizeEspHomeId } from "../../src/util/esphome-id.js";

describe("normalizeEspHomeId", () => {
  it("passes already-valid ids through unchanged", () => {
    expect(normalizeEspHomeId("morning_alarm")).toBe("morning_alarm");
    expect(normalizeEspHomeId("Script1")).toBe("Script1");
    expect(normalizeEspHomeId("_foo")).toBe("_foo");
  });

  it("preserves case (no forced lowercase)", () => {
    expect(normalizeEspHomeId("MyScript")).toBe("MyScript");
    expect(normalizeEspHomeId("camelCase")).toBe("camelCase");
  });

  it("collapses runs of invalid characters to a single underscore", () => {
    // The screenshot's regression case: spaces and slashes all
    // collapse into one underscore each, including the "is / a" run.
    expect(normalizeEspHomeId("this is / a invalid id")).toBe("this_is_a_invalid_id");
    expect(normalizeEspHomeId("my-script-name")).toBe("my_script_name");
    expect(normalizeEspHomeId("kitchen.sensor")).toBe("kitchen_sensor");
  });

  it("collapses leading and trailing whitespace to bordering underscores", () => {
    // Deliberately doesn't strip — stripping mid-type would jump the
    // cursor for a user who hasn't finished typing yet.
    expect(normalizeEspHomeId("  hello  ")).toBe("_hello_");
  });

  it("returns empty for empty input", () => {
    expect(normalizeEspHomeId("")).toBe("");
  });

  it("collapses non-ASCII characters", () => {
    // No diacritic-folding (unlike friendlyNameSlugify) — non-ASCII
    // letters aren't valid YAML keys in ESPHome's grammar, so they
    // collapse to underscore alongside other invalid chars.
    expect(normalizeEspHomeId("Café")).toBe("Caf_");
    expect(normalizeEspHomeId("naïve")).toBe("na_ve");
  });

  it("is idempotent", () => {
    const once = normalizeEspHomeId("this is / a invalid id");
    expect(normalizeEspHomeId(once)).toBe(once);
  });
});
