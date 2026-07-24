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

/** Toggle `navigator.serial` presence for a test; returns a restore function. */
export function withWebSerial(present: boolean): () => void {
  const had = "serial" in navigator;
  const previous = (navigator as unknown as { serial?: unknown }).serial;
  if (present) {
    Object.defineProperty(navigator, "serial", { configurable: true, value: {} });
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
