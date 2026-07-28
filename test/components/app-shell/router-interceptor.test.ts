// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { ReactiveController } from "lit";
import type { LocalizeFunc } from "../../../src/common/localize.js";
import { createRouter } from "../../../src/components/app-shell/router.js";
import { PopLeaveGuardController } from "../../../src/util/navigation.js";
import { identityLocalize } from "../../_dom.js";

/**
 * Pins createRouter's interceptor wiring: the leave-guard veto must land
 * before the Router's own popstate listener commits a route. The guard
 * suite installs the interceptor itself, so only this file catches the
 * install call going missing.
 */

class FakeShell extends HTMLElement {
  controllers: ReactiveController[] = [];
  addController(c: ReactiveController) {
    this.controllers.push(c);
  }
  removeController() {}
  requestUpdate() {}
  updateComplete = Promise.resolve(true);
  connect() {
    for (const c of this.controllers) c.hostConnected?.();
  }
}
customElements.define("fake-shell", FakeShell);

describe("createRouter interceptor wiring", () => {
  it("the guard's veto lands before the Router's popstate handler", () => {
    const shell = new FakeShell();
    const router = createRouter(shell as never, {
      onPending: () => {},
      localize: () => identityLocalize as LocalizeFunc,
      isAuthed: () => true,
    });
    // Mocked before connect: happy-dom lacks URLPattern, and only the
    // dispatch path matters here.
    const goto = vi.spyOn(router, "goto").mockResolvedValue(undefined);
    // Router registers its popstate listener here, after the install.
    shell.connect();
    goto.mockClear();

    const guardHost = new FakeShell();
    let isDirty = true;
    new PopLeaveGuardController(guardHost as never, {
      confirmLeave: () => Promise.resolve(false),
      isDirty: () => isDirty,
      url: () => "/device/kitchen.yaml",
    });
    guardHost.connect();

    window.dispatchEvent(new PopStateEvent("popstate"));
    // Dirty pop: the interceptor's stopImmediatePropagation beat the
    // router — without the createRouter install, goto commits first.
    expect(goto).not.toHaveBeenCalled();

    isDirty = false;
    window.dispatchEvent(new PopStateEvent("popstate"));
    // Clean pop falls through to the router as usual.
    expect(goto).toHaveBeenCalledTimes(1);
  });
});
