/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";

import "../_mock-webawesome.js";

import { ESPHomeProcessTerminal } from "../../src/components/process-terminal/process-terminal.js";

function mount(): ESPHomeProcessTerminal {
  const el = new ESPHomeProcessTerminal();
  document.body.appendChild(el);
  return el;
}

const banner = (el: ESPHomeProcessTerminal) =>
  el.shadowRoot!.querySelector(".status-banner");

describe("process-terminal connectionLost", () => {
  it("overrides state and message with an error banner, reverting on clear", async () => {
    const el = mount();
    el.state = "running";
    el.statusMessage = "";
    el.connectionLost = true;
    el.connectionLostMessage = "Connection lost. Reconnecting…";
    await el.updateComplete;
    expect(banner(el)!.classList.contains("status-banner--error")).toBe(true);
    expect(banner(el)!.textContent).toContain("Connection lost. Reconnecting…");
    expect(banner(el)!.getAttribute("role")).toBe("status");

    el.connectionLost = false;
    await el.updateComplete;
    expect(banner(el)).toBeNull();
    expect(el.state).toBe("running");
  });

  it("takes precedence over a success state without losing it", async () => {
    const el = mount();
    el.state = "success";
    el.statusMessage = "Done!";
    el.connectionLost = true;
    el.connectionLostMessage = "Reconnecting…";
    await el.updateComplete;
    expect(banner(el)!.classList.contains("status-banner--error")).toBe(true);
    expect(banner(el)!.textContent).toContain("Reconnecting…");

    el.connectionLost = false;
    await el.updateComplete;
    expect(banner(el)!.classList.contains("status-banner--success")).toBe(true);
    expect(banner(el)!.textContent).toContain("Done!");
  });

  it("pauses the streaming dot while flagged", async () => {
    const el = mount();
    el.streaming = true;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".streaming-dot")).not.toBeNull();

    el.connectionLost = true;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".streaming-dot")).toBeNull();
  });

  it("overrides the card variant's status and hides the stale detail", async () => {
    const el = mount();
    el.variant = "card";
    el.state = "running";
    el.statusMessage = "Compiling…";
    el.statusDetail = "detail";
    el.connectionLost = true;
    el.connectionLostMessage = "Reconnecting…";
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".status-text")!.textContent).toBe(
      "Reconnecting…"
    );
    expect(el.shadowRoot!.querySelector(".status-detail")).toBeNull();
    expect(el.shadowRoot!.querySelector(".status-icon--error")).not.toBeNull();

    el.connectionLost = false;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".status-text")!.textContent).toBe("Compiling…");
    expect(el.shadowRoot!.querySelector(".status-detail")!.textContent).toBe("detail");
  });
});
