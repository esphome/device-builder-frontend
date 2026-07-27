// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReconnectPillGate,
  renderReconnectPill,
  renderRouteLoadingBar,
} from "../../../src/components/app-shell/connection-overlays.js";
import { identityLocalize, renderInto } from "../../_dom.js";
import type { LocalizeFunc } from "../../../src/common/localize.js";

/**
 * Pins the overlays' assistive-tech contract (the bar is decorative,
 * the pill announces) and the pill's timer gate.
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

describe("ReconnectPillGate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeGate = () => {
    const changes: boolean[] = [];
    return { changes, gate: new ReconnectPillGate(800, (v) => changes.push(v)) };
  };

  it("stays silent for a blip shorter than the delay", () => {
    const { changes, gate } = makeGate();
    gate.disconnected();
    vi.advanceTimersByTime(799);
    gate.connected();
    vi.advanceTimersByTime(2000);

    // Never true — a sub-delay blip must not flash the pill nor fire
    // its role="status" announcement.
    expect(changes).toEqual([false]);
  });

  it("shows once the outage crosses the delay", () => {
    const { changes, gate } = makeGate();
    gate.disconnected();
    vi.advanceTimersByTime(800);
    expect(changes).toEqual([true]);

    gate.connected();
    expect(changes).toEqual([true, false]);
  });

  it("keeps the first outage's clock across repeat disconnects", () => {
    const { changes, gate } = makeGate();
    gate.disconnected();
    vi.advanceTimersByTime(500);
    // A reconnect attempt failing re-fires onDisconnected; the pill is
    // still due 800ms after the outage began, not 800ms after the retry.
    gate.disconnected();
    vi.advanceTimersByTime(300);

    expect(changes).toEqual([true]);
  });
});
