// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import { modeUrl, readMode, writeMode } from "../../src/web/web-mode.js";

afterEach(() => {
  window.history.pushState(null, "", "/");
});

describe("readMode", () => {
  it("defaults to esp when no pico param", () => {
    expect(readMode("")).toBe("esp");
    expect(readMode("?foo=bar")).toBe("esp");
  });

  it("returns pico when the pico param is present", () => {
    expect(readMode("?pico")).toBe("pico");
    expect(readMode("?pico=")).toBe("pico");
    expect(readMode("?foo=bar&pico")).toBe("pico");
  });

  it("returns nrf when the nrf param is present", () => {
    expect(readMode("?nrf")).toBe("nrf");
    expect(readMode("?foo=bar&nrf")).toBe("nrf");
  });

  it("reads window.location.search by default", () => {
    window.history.pushState(null, "", "/?pico");
    expect(readMode()).toBe("pico");
  });
});

describe("modeUrl", () => {
  it("adds a bare ?pico for pico mode", () => {
    expect(modeUrl("pico", new URL("https://web.esphome.io/"))).toBe("/?pico");
  });

  it("drops the pico param for esp mode", () => {
    expect(modeUrl("esp", new URL("https://web.esphome.io/?pico"))).toBe("/");
  });

  it("swaps one mode flag for another", () => {
    expect(modeUrl("nrf", new URL("https://web.esphome.io/?pico"))).toBe("/?nrf");
    expect(modeUrl("pico", new URL("https://web.esphome.io/?foo=bar&nrf"))).toBe(
      "/?foo=bar&pico"
    );
    expect(modeUrl("esp", new URL("https://web.esphome.io/?nrf"))).toBe("/");
  });

  it("preserves other query params and normalizes the empty value", () => {
    expect(modeUrl("pico", new URL("https://web.esphome.io/?foo=bar"))).toBe(
      "/?foo=bar&pico"
    );
    expect(modeUrl("esp", new URL("https://web.esphome.io/?foo=bar&pico"))).toBe(
      "/?foo=bar"
    );
  });

  it("keeps the hash fragment", () => {
    expect(modeUrl("pico", new URL("https://web.esphome.io/#x"))).toBe("/?pico#x");
  });

  it("leaves other empty-valued params untouched (only pico is bare)", () => {
    // Regression: the old regex stripped '=' from every empty param.
    expect(modeUrl("pico", new URL("https://web.esphome.io/?foo=&bar=1"))).toBe(
      "/?foo=&bar=1&pico"
    );
    expect(modeUrl("esp", new URL("https://web.esphome.io/?foo=&pico"))).toBe("/?foo=");
  });
});

describe("writeMode", () => {
  it("pushes the pico URL into history without reloading", () => {
    writeMode("pico");
    expect(window.location.search).toBe("?pico");
    expect(readMode()).toBe("pico");
  });

  it("clears the param when switching back to esp", () => {
    writeMode("pico");
    writeMode("esp");
    expect(window.location.search).toBe("");
    expect(readMode()).toBe("esp");
  });
});
