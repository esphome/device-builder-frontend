/**
 * Mock WebSocket used in ESPHomeAPI tests. Supports controlled open/close/message
 * events and records every payload the client sends for assertions.
 */
export class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  url: string;
  private _listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this._listeners.get(type)?.delete(listener);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this._fire("close", {});
  }

  // Test helpers -----------------------------------------------------

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this._fire("open", {});
  }

  /** Simulate the server sending a JSON frame. */
  receive(data: unknown): void {
    this._fire("message", { data: JSON.stringify(data) });
  }

  triggerError(): void {
    this._fire("error", {});
  }

  sentAs<T = Record<string, unknown>>(index: number): T {
    return JSON.parse(this.sent[index]) as T;
  }

  private _fire(type: string, event: unknown): void {
    this._listeners.get(type)?.forEach((l) => l(event));
  }

  static reset(): void {
    MockWebSocket.instances = [];
  }

  static latest(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }
}

type WindowListener = (event: unknown) => void;

let windowListeners = new Map<string, Set<WindowListener>>();

/** Minimal window stand-in: location for URL building plus the event
 *  surface the API client's offline/online listeners need. */
export function installMockWindow(
  location: { protocol: string; host: string } = {
    protocol: "http:",
    host: "localhost:8000",
  }
): void {
  const listeners = new Map<string, Set<WindowListener>>();
  windowListeners = listeners;
  (globalThis as unknown as { window: unknown }).window = {
    location,
    addEventListener(type: string, listener: WindowListener): void {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: WindowListener): void {
      listeners.get(type)?.delete(listener);
    },
  };
}

/** Fire a window event (e.g. 'offline' / 'online') on the mock window. */
export function fireWindowEvent(type: string): void {
  windowListeners.get(type)?.forEach((l) => l({}));
}

export function installMockWebSocket(): void {
  MockWebSocket.reset();
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;
  installMockWindow();
}

export function uninstallMockWebSocket(): void {
  MockWebSocket.reset();
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
  delete (globalThis as unknown as { window?: unknown }).window;
}
