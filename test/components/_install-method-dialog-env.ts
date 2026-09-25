// Shared window/navigator Web Serial + Web Bluetooth environment stub for the
// install-method-dialog suites. Descriptors are captured at import;
// call restoreWebSerialEnv from afterEach.
/* eslint-disable @typescript-eslint/no-explicit-any */
const origSerial = Object.getOwnPropertyDescriptor(navigator, "serial");
const origSecure = Object.getOwnPropertyDescriptor(window, "isSecureContext");
const origLocation = Object.getOwnPropertyDescriptor(window, "location");
const origBluetooth = Object.getOwnPropertyDescriptor(navigator, "bluetooth");

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

/** Install the Web Bluetooth API object; ``adapter`` is what its availability query answers. */
export function setBluetooth(available: boolean, adapter = true): void {
  if (available) {
    Object.defineProperty(navigator, "bluetooth", {
      configurable: true,
      value: { getAvailability: async () => adapter },
    });
  } else if ("bluetooth" in navigator) {
    delete (navigator as any).bluetooth;
  }
}

export function restoreWebSerialEnv(): void {
  if (origSerial) Object.defineProperty(navigator, "serial", origSerial);
  else if ("serial" in navigator) delete (navigator as any).serial;
  if (origSecure) Object.defineProperty(window, "isSecureContext", origSecure);
  if (origLocation) Object.defineProperty(window, "location", origLocation);
  if (origBluetooth) Object.defineProperty(navigator, "bluetooth", origBluetooth);
  else if ("bluetooth" in navigator) delete (navigator as any).bluetooth;
}
