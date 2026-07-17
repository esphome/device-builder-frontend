import type { ReactiveController, ReactiveControllerHost } from "lit";
import { vi } from "vitest";
import { LogBuffer } from "../src/util/log-buffer.js";

/** Minimal ReactiveControllerHost for controller unit tests. */
export class FakeHost implements ReactiveControllerHost {
  controllers: ReactiveController[] = [];
  updates = 0;
  addController(c: ReactiveController) {
    this.controllers.push(c);
  }
  removeController() {}
  requestUpdate() {
    this.updates++;
  }
  updateComplete = Promise.resolve(true);
}

/** Spy-based variant for tests that assert on the host calls. */
export const fakeHost = (): ReactiveControllerHost =>
  ({
    addController: vi.fn(),
    removeController: vi.fn(),
    requestUpdate: vi.fn(),
    updateComplete: Promise.resolve(true),
  }) as unknown as ReactiveControllerHost;

/**
 * A real LogBuffer whose enqueue lands synchronously.
 *
 * For flow tests, which drive a dialog's log sink but have no rAF to fire;
 * the batching itself is pinned by the dialogs' own batching tests.
 */
export function fakeLogBuffer(): LogBuffer {
  const buffer = new LogBuffer(new FakeHost());
  buffer.enqueue = (line: string) => void buffer.append([line]);
  return buffer;
}
