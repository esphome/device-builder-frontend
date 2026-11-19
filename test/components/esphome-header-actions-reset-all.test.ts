/**
 * @vitest-environment happy-dom
 *
 * "Reset all build servers" only makes sense with two or more reset-capable
 * servers; with one, that server's own reset button already covers it.
 */
import { describe, expect, it, vi } from "vitest";

import type { PairingSummary } from "../../src/api/types/remote-build.js";
import { renderOpenHeaderMenu } from "./_esphome-header-actions-helpers.js";

const pairing = (pin: string, o: Partial<PairingSummary> = {}): PairingSummary =>
  ({
    pin_sha256: pin,
    status: "approved",
    connected: true,
    reset_build_env_supported: true,
    ...o,
  }) as PairingSummary;

const entries = (el: HTMLElement) =>
  Array.from(el.shadowRoot!.querySelectorAll(".menu-item")).filter(
    (i) => i.textContent?.trim() === "layout.reset_all_build_servers"
  );

describe("header-actions reset-all build servers entry", () => {
  it("shows with two capable servers and fires the event on click", async () => {
    const el = await renderOpenHeaderMenu({
      _localize: (k) => k,
      _pairings: new Map([
        ["a", pairing("a")],
        ["b", pairing("b")],
      ]),
    });
    const seen = vi.fn();
    el.addEventListener("open-reset-all-peer-build-env", seen);
    const [item] = entries(el);
    expect(item).toBeDefined();
    (item as HTMLElement).click();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("hides with one capable server", async () => {
    const el = await renderOpenHeaderMenu({
      _localize: (k) => k,
      _pairings: new Map([
        ["a", pairing("a")],
        ["b", pairing("b", { connected: false })],
      ]),
    });
    expect(entries(el)).toHaveLength(0);
  });

  it("hides before pairings load", async () => {
    const el = await renderOpenHeaderMenu({ _localize: (k) => k, _pairings: null });
    expect(entries(el)).toHaveLength(0);
  });
});
