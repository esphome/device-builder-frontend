/**
 * @vitest-environment happy-dom
 *
 * Unit coverage for the shared <esphome-process-terminal> surface (#346):
 * status banner per state, card spinner/icon, progress bar visibility,
 * streaming dot, and scrollToBottom() forwarding to the inner ansi-log.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ESPHomeProcessTerminal } from "../../../src/components/process-terminal/process-terminal.js";

async function mount(
  setup: (el: ESPHomeProcessTerminal) => void
): Promise<ESPHomeProcessTerminal> {
  const el = new ESPHomeProcessTerminal();
  setup(el);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.replaceChildren();
});

const sr = (el: ESPHomeProcessTerminal) => el.shadowRoot!;

describe("process-terminal status banner (stream)", () => {
  it("renders a success banner with the check icon", async () => {
    const el = await mount((e) => {
      e.state = "success";
      e.statusMessage = "Done";
    });
    const banner = sr(el).querySelector(".status-banner");
    expect(banner?.classList.contains("status-banner--success")).toBe(true);
    expect(banner?.querySelector("wa-icon")?.getAttribute("name")).toBe("check-circle");
    expect(banner?.textContent).toContain("Done");
  });

  it("renders an error banner with the alert icon", async () => {
    const el = await mount((e) => {
      e.state = "error";
      e.statusMessage = "Failed";
    });
    const banner = sr(el).querySelector(".status-banner");
    expect(banner?.classList.contains("status-banner--error")).toBe(true);
    expect(banner?.querySelector("wa-icon")?.getAttribute("name")).toBe("alert-circle");
  });

  it("renders no banner while running / idle", async () => {
    const running = await mount((e) => (e.state = "running"));
    expect(sr(running).querySelector(".status-banner")).toBeNull();
    const idle = await mount((e) => (e.state = null));
    expect(sr(idle).querySelector(".status-banner")).toBeNull();
  });
});

describe("process-terminal streaming dot", () => {
  it("shows the dot only while streaming", async () => {
    const on = await mount((e) => (e.streaming = true));
    expect(sr(on).querySelector(".streaming-dot")).not.toBeNull();
    const off = await mount((e) => (e.streaming = false));
    expect(sr(off).querySelector(".streaming-dot")).toBeNull();
  });
});

describe("process-terminal card variant", () => {
  it("shows a spinner while running", async () => {
    const el = await mount((e) => {
      e.variant = "card";
      e.state = "running";
    });
    expect(sr(el).querySelector(".status wa-spinner")).not.toBeNull();
    // No full-height stream content / built-in ansi-log in the card variant.
    expect(sr(el).querySelector(".content")).toBeNull();
    expect(sr(el).querySelector("esphome-ansi-log")).toBeNull();
  });

  it("shows the success icon and detail text", async () => {
    const el = await mount((e) => {
      e.variant = "card";
      e.state = "success";
      e.statusMessage = "Installed";
      e.statusDetail = "saved.bin";
    });
    expect(sr(el).querySelector(".status-icon--success")).not.toBeNull();
    expect(sr(el).querySelector(".status-text")?.textContent).toContain("Installed");
    expect(sr(el).querySelector(".status-detail")?.textContent).toContain("saved.bin");
  });

  it("hides the progress bar when progress is null and shows it at a percent", async () => {
    const hidden = await mount((e) => {
      e.variant = "card";
      e.progress = null;
    });
    expect(sr(hidden).querySelector(".progress-bar")).toBeNull();
    const shown = await mount((e) => {
      e.variant = "card";
      e.progress = 42;
    });
    expect(
      sr(shown).querySelector(".progress-bar-fill")?.getAttribute("style")
    ).toContain("width:42%");
  });
});

describe("process-terminal scrollToBottom", () => {
  it("forwards to the inner ansi-log (stream variant)", async () => {
    const el = await mount((e) => (e.lines = ["a", "b"]));
    const ansi = sr(el).querySelector("esphome-ansi-log") as HTMLElement & {
      scrollToBottom: () => void;
    };
    const spy = vi.spyOn(ansi, "scrollToBottom").mockImplementation(() => {});
    el.scrollToBottom();
    expect(spy).toHaveBeenCalledOnce();
  });
});
