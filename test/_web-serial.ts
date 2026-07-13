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
