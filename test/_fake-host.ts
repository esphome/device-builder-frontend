import type { ReactiveController, ReactiveControllerHost } from "lit";
import { vi } from "vitest";

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
