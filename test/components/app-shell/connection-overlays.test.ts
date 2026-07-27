// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  renderReconnectPill,
  renderRouteLoadingBar,
} from "../../../src/components/app-shell/connection-overlays.js";
import { identityLocalize, renderInto } from "../../_dom.js";
import type { LocalizeFunc } from "../../../src/common/localize.js";

/**
 * Pins the overlays' assistive-tech contract: the bar is decorative,
 * the pill announces.
 */

describe("connection overlays", () => {
  it("hides the route loading bar from assistive tech", () => {
    const bar = renderInto(renderRouteLoadingBar()).querySelector(".route-loading-bar");
    expect(bar).not.toBeNull();
    // Purely visual feedback; the failure toast is the announced channel.
    expect(bar!.getAttribute("aria-hidden")).toBe("true");
    expect(bar!.hasAttribute("role")).toBe(false);
  });

  it("announces the reconnect pill as a status", () => {
    const pill = renderInto(
      renderReconnectPill(identityLocalize as LocalizeFunc)
    ).querySelector(".reconnect-pill");
    expect(pill).not.toBeNull();
    expect(pill!.getAttribute("role")).toBe("status");
    expect(pill!.textContent).toContain("layout.reconnecting");
  });
});
