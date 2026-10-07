import { vi } from "vitest";
import { PickerActivationError } from "../src/util/picker-activation.js";

/** The disconnect event of a fake port, to spread into one a test builds itself. */
export function disconnectEvents() {
  const listeners = new Set<EventListener>();
  return {
    addEventListener: (_t: string, l: EventListener) => void listeners.add(l),
    removeEventListener: (_t: string, l: EventListener) => void listeners.delete(l),
    fire: () => [...listeners].forEach((l) => l(new Event("disconnect"))),
    listenerCount: () => listeners.size,
  };
}

export interface FakeSerialPortOptions {
  /** Takes what the host writes once the port is open. */
  feed: (chunk: Uint8Array) => void | Promise<void>;
  /** Fail setSignals as an adapter without control lines would. */
  noSignals?: boolean;
  /** Never settle a line change, as on a board unplugged mid change. */
  hangSignals?: boolean;
  /** Forget the streams on close() and refuse a second open(), as a real port does. */
  closes?: boolean;
  onOpen?: (options: SerialOptions) => void;
  /** A line change the adapter took; ``signals`` already holds it. */
  onSignals?: (signals: SerialOutputSignals) => void;
}

/**
 * A fake Web Serial port like a freshly picked one: no streams until
 * ``open()``, the host's writes fed to the simulated device, its answers
 * put on the readable with ``enqueue``, and the signal changes kept.
 */
export function fakeSerialPort(opts: FakeSerialPortOptions) {
  let out: ReadableStreamDefaultController<Uint8Array> | null = null;
  const signals: SerialOutputSignals[] = [];
  const port = {
    ...disconnectEvents(),
    readable: null as ReadableStream<Uint8Array> | null,
    writable: null as WritableStream<Uint8Array> | null,
    open: vi.fn(async (options: SerialOptions) => {
      if (opts.closes && port.readable) {
        throw new DOMException("already open", "InvalidStateError");
      }
      port.readable = new ReadableStream<Uint8Array>({ start: (c) => (out = c) });
      port.writable = new WritableStream<Uint8Array>({ write: opts.feed });
      opts.onOpen?.(options);
    }),
    close: vi.fn(async () => {
      if (!opts.closes) return;
      try {
        out?.close();
      } catch {
        // already closed by the reader's cancel
      }
      out = null;
      port.readable = null;
      port.writable = null;
    }),
    setSignals: vi.fn(async (s: SerialOutputSignals) => {
      if (opts.hangSignals) await new Promise(() => {});
      if (opts.noSignals) throw new DOMException("no lines", "NetworkError");
      signals.push(s);
      opts.onSignals?.(s);
    }),
  };
  return {
    port: port as unknown as SerialPort,
    raw: port,
    signals,
    /** Bytes the device puts on the line. */
    enqueue: (bytes: Uint8Array) => out?.enqueue(bytes),
    isOpen: () => out !== null,
    /** The adapter goes away: the readable ends. */
    dropLink: () => out?.close(),
  };
}

/** Fake SerialPort whose disconnect listeners tests can fire directly. */
export function makeDisconnectPort(): SerialPort & {
  fire: () => void;
  listenerCount: () => number;
} {
  return disconnectEvents() as unknown as SerialPort & {
    fire: () => void;
    listenerCount: () => number;
  };
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

/**
 * Set whether the click still counts (``navigator.userActivation``), or
 * remove it with null as a browser that does not report it. Returns the restore.
 */
export function withUserActivation(active: boolean | null): () => void {
  const orig = Object.getOwnPropertyDescriptor(navigator, "userActivation");
  if (active === null) {
    delete (navigator as unknown as { userActivation?: unknown }).userActivation;
  } else {
    Object.defineProperty(navigator, "userActivation", {
      configurable: true,
      value: { isActive: active },
    });
  }
  return () => {
    if (orig) Object.defineProperty(navigator, "userActivation", orig);
    else delete (navigator as unknown as { userActivation?: unknown }).userActivation;
  };
}

/** What a browser throws from a picker asked for without a live click. */
export const pickerRefused = () =>
  new DOMException(
    "Must be handling a user gesture to show a permission request.",
    "SecurityError"
  );

/** The error a picker helper throws for a click that ran out. */
export const lapsedPick = () => new PickerActivationError(pickerRefused());
