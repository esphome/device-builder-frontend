/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import { detectEnvironment } from "../../src/util/environment.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const origLocation = Object.getOwnPropertyDescriptor(window, "location");
const setHost = (hostname: string) =>
  Object.defineProperty(window, "location", { configurable: true, value: { hostname } });
const api = (haAddon = false) => ({ serverInfo: { ha_addon: haAddon } }) as ESPHomeAPI;

afterEach(() => {
  if (origLocation) Object.defineProperty(window, "location", origLocation);
});
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("detectEnvironment", () => {
  it("ha_addon wins regardless of host", () => {
    setHost("example.com");
    expect(detectEnvironment(api(true))).toBe("ha-addon");
  });

  it("treats loopback hosts (incl. 0.0.0.0) as localhost", () => {
    for (const host of ["localhost", "127.0.0.1", "::1", "0.0.0.0"]) {
      setHost(host);
      expect(detectEnvironment(api())).toBe("localhost");
    }
  });

  it("treats other hosts as remote", () => {
    setHost("192.168.1.5");
    expect(detectEnvironment(api())).toBe("remote");
  });
});
