// Shared window/navigator Web Serial environment stub for the
// install-method-dialog suites. Descriptors are captured at import;
// call restoreWebSerialEnv from afterEach.
/* eslint-disable @typescript-eslint/no-explicit-any */
const origSerial = Object.getOwnPropertyDescriptor(navigator, "serial");
const origSecure = Object.getOwnPropertyDescriptor(window, "isSecureContext");
const origLocation = Object.getOwnPropertyDescriptor(window, "location");

export function setWebSerialEnv(opts: {
  serial: boolean;
  secure: boolean;
  href: string;
}): void {
  if (opts.serial) {
    Object.defineProperty(navigator, "serial", { configurable: true, value: {} });
  } else if ("serial" in navigator) {
    delete (navigator as any).serial;
  }
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: opts.secure,
  });
  const u = new URL(opts.href);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { hostname: u.hostname, href: u.href },
  });
}

export function setLocalhostWithWebSerial(): void {
  setWebSerialEnv({ serial: true, secure: true, href: "http://localhost:6052/" });
}

export function restoreWebSerialEnv(): void {
  if (origSerial) Object.defineProperty(navigator, "serial", origSerial);
  else if ("serial" in navigator) delete (navigator as any).serial;
  if (origSecure) Object.defineProperty(window, "isSecureContext", origSecure);
  if (origLocation) Object.defineProperty(window, "location", origLocation);
}
