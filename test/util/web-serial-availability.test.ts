/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  isWebSerialSupported,
  secureLoopbackUrl,
  webSerialAvailability,
} from "../../src/util/web-serial.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const origSerial = Object.getOwnPropertyDescriptor(navigator, "serial");
const origSecure = Object.getOwnPropertyDescriptor(window, "isSecureContext");
const origLocation = Object.getOwnPropertyDescriptor(window, "location");

function setSerial(present: boolean) {
  if (present) {
    Object.defineProperty(navigator, "serial", { configurable: true, value: {} });
  } else if ("serial" in navigator) {
    delete (navigator as any).serial;
  }
}
function setSecure(value: boolean) {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value });
}
function setLocation(href: string) {
  const u = new URL(href);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { hostname: u.hostname, href: u.href },
  });
}

afterEach(() => {
  if (origSerial) Object.defineProperty(navigator, "serial", origSerial);
  else if ("serial" in navigator) delete (navigator as any).serial;
  if (origSecure) Object.defineProperty(window, "isSecureContext", origSecure);
  if (origLocation) Object.defineProperty(window, "location", origLocation);
});
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("webSerialAvailability", () => {
  it("'available' when navigator.serial exists (regardless of context)", () => {
    setSerial(true);
    setSecure(false);
    expect(webSerialAvailability()).toBe("available");
    expect(isWebSerialSupported()).toBe(true);
  });

  it("'insecure-context' when the API is missing on an insecure origin", () => {
    setSerial(false);
    setSecure(false);
    expect(webSerialAvailability()).toBe("insecure-context");
    expect(isWebSerialSupported()).toBe(false);
  });

  it("'unsupported' when the API is missing on a secure origin", () => {
    setSerial(false);
    setSecure(true);
    expect(webSerialAvailability()).toBe("unsupported");
  });
});

describe("secureLoopbackUrl", () => {
  it("rewrites a 0.0.0.0 dashboard to its 127.0.0.1 equivalent (same port + path)", () => {
    setLocation("http://0.0.0.0:6052/path?x=1");
    expect(secureLoopbackUrl()).toBe("http://127.0.0.1:6052/path?x=1");
  });

  it("returns null for any non-0.0.0.0 host (could be a different machine)", () => {
    setLocation("http://192.168.1.5:6052/");
    expect(secureLoopbackUrl()).toBe(null);
    setLocation("http://localhost:6052/");
    expect(secureLoopbackUrl()).toBe(null);
  });
});
