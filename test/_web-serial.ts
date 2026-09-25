/** Fake SerialPort whose disconnect listeners tests can fire directly. */
export function makeDisconnectPort(): SerialPort & {
  fire: () => void;
  listenerCount: () => number;
} {
  const listeners = new Set<EventListener>();
  return {
    addEventListener: (_t: string, l: EventListener) => listeners.add(l),
    removeEventListener: (_t: string, l: EventListener) => listeners.delete(l),
    fire: () => [...listeners].forEach((l) => l(new Event("disconnect"))),
    listenerCount: () => listeners.size,
  } as unknown as SerialPort & { fire: () => void; listenerCount: () => number };
}

/** Install (or remove, with null) a `navigator.bluetooth` stub; returns a restore function. */
export function withWebBluetooth(value: object | null): () => void {
  const orig = Object.getOwnPropertyDescriptor(navigator, "bluetooth");
  if (value) {
    Object.defineProperty(navigator, "bluetooth", { configurable: true, value });
  } else {
    delete (navigator as unknown as { bluetooth?: unknown }).bluetooth;
  }
  return () => {
    if (orig) Object.defineProperty(navigator, "bluetooth", orig);
    else delete (navigator as unknown as { bluetooth?: unknown }).bluetooth;
  };
}

/** Toggle `navigator.serial` presence for a test (``value`` is the stub); returns a restore function. */
export function withWebSerial(present: boolean, value: object = {}): () => void {
  const had = "serial" in navigator;
  const previous = (navigator as unknown as { serial?: unknown }).serial;
  if (present) {
    Object.defineProperty(navigator, "serial", { configurable: true, value });
  } else if (had) {
    delete (navigator as unknown as { serial?: unknown }).serial;
  }
  return () => {
    if (had) {
      Object.defineProperty(navigator, "serial", { configurable: true, value: previous });
    } else {
      delete (navigator as unknown as { serial?: unknown }).serial;
    }
  };
}
