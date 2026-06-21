import { describe, expect, it } from "vitest";
import {
  buildDeviceUrl,
  readUrlLine,
  readUrlParam,
  readUrlSections,
} from "../../src/pages/device-url-state.js";

describe("readUrlParam", () => {
  it("returns the value when present", () => {
    expect(readUrlParam("?section=wifi", "section", null)).toBe("wifi");
  });

  it("returns the fallback when absent", () => {
    expect(readUrlParam("?other=1", "section", null)).toBeNull();
    expect(readUrlParam("", "section", "default")).toBe("default");
  });

  it("returns an empty string for a present-but-empty param", () => {
    expect(readUrlParam("?section=", "section", "fallback")).toBe("");
  });
});

describe("readUrlLine", () => {
  it("parses a numeric line", () => {
    expect(readUrlLine("?line=42")).toBe(42);
  });

  it("returns undefined when absent", () => {
    expect(readUrlLine("?section=wifi")).toBeUndefined();
    expect(readUrlLine("")).toBeUndefined();
  });

  it("returns undefined for a non-numeric line", () => {
    expect(readUrlLine("?line=abc")).toBeUndefined();
  });

  it("treats an empty line param as absent", () => {
    // An empty value is falsy, so we bail before Number() would coerce
    // it to 0.
    expect(readUrlLine("?line=")).toBeUndefined();
  });
});

describe("readUrlSections", () => {
  it("parses a comma-separated list of indices", () => {
    expect(readUrlSections("?open=0,2,5")).toEqual([0, 2, 5]);
  });

  it("returns an empty array when absent", () => {
    expect(readUrlSections("?section=wifi")).toEqual([]);
    expect(readUrlSections("")).toEqual([]);
  });

  it("drops non-numeric fragments but keeps empty-fragment zeros (#650)", () => {
    // A trailing/leading/double comma yields empty fragments that
    // Number() coerces to 0 — a valid index — not NaN. Non-numeric
    // fragments coerce to NaN and are dropped.
    expect(readUrlSections("?open=0,,2")).toEqual([0, 0, 2]);
    expect(readUrlSections("?open=1,foo,3")).toEqual([1, 3]);
  });

  it("returns an empty array for an empty open param", () => {
    expect(readUrlSections("?open=")).toEqual([]);
  });
});

describe("buildDeviceUrl", () => {
  const base = "/device";

  it("sets section and line when both are present", () => {
    const url = buildDeviceUrl("", base, {
      selectedSection: "wifi",
      selectedFromLine: 12,
      openSections: [],
    });
    expect(url).toBe("/device?section=wifi&line=12");
  });

  it("omits line when the section has no line", () => {
    const url = buildDeviceUrl("", base, {
      selectedSection: "wifi",
      selectedFromLine: undefined,
      openSections: [],
    });
    expect(url).toBe("/device?section=wifi");
  });

  it("drops a stale line when the section loses its line", () => {
    const url = buildDeviceUrl("?section=wifi&line=12", base, {
      selectedSection: "wifi",
      selectedFromLine: undefined,
      openSections: [],
    });
    expect(url).toBe("/device?section=wifi");
  });

  it("clears section and line when no section is selected", () => {
    const url = buildDeviceUrl("?section=wifi&line=12", base, {
      selectedSection: null,
      selectedFromLine: undefined,
      openSections: [],
    });
    expect(url).toBe("/device");
  });

  it("serializes open sections as a comma-separated list", () => {
    const url = buildDeviceUrl("", base, {
      selectedSection: null,
      selectedFromLine: undefined,
      openSections: new Set([0, 2, 5]),
    });
    expect(url).toBe("/device?open=0%2C2%2C5");
  });

  it("removes the open param when no sections are open", () => {
    const url = buildDeviceUrl("?open=1,2", base, {
      selectedSection: null,
      selectedFromLine: undefined,
      openSections: [],
    });
    expect(url).toBe("/device");
  });

  it("preserves unrelated query params", () => {
    const url = buildDeviceUrl("?keep=me", base, {
      selectedSection: "wifi",
      selectedFromLine: undefined,
      openSections: [],
    });
    expect(url).toBe("/device?keep=me&section=wifi");
  });

  it("round-trips through the readers", () => {
    const url = buildDeviceUrl("", base, {
      selectedSection: "sensor",
      selectedFromLine: 7,
      openSections: new Set([1, 3]),
    });
    const search = url.slice(url.indexOf("?"));
    expect(readUrlParam(search, "section", null)).toBe("sensor");
    expect(readUrlLine(search)).toBe(7);
    expect(readUrlSections(search)).toEqual([1, 3]);
  });
});
