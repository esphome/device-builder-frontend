import type { ReactiveController, ReactiveControllerHost } from "lit";

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
