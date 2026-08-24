/**
 * @vitest-environment happy-dom
 *
 * Pins the sonner shadow-root override that lifts bottom-right toasts
 * above a page's published --esphome-toast-clearance.
 */

import { describe, expect, it } from "vitest";

describe("applySonnerOverrides", () => {
  it("injects the toast clearance rule into the toaster shadow root", async () => {
    const host = document.createElement("div");
    host.setAttribute("data-sonner-toasters", "");
    host.attachShadow({ mode: "open" });
    document.body.appendChild(host);

    await import("../../src/styles/apply-theme.js");

    const style = host.shadowRoot?.querySelector("style[data-esphome-overrides]");
    expect(style?.textContent).toContain("--esphome-toast-clearance");
    expect(style?.textContent).toContain(
      '[data-position*="bottom"][data-position*="right"]'
    );
  });
});
