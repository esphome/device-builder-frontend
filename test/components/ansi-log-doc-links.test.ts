/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { IntegrationDoc } from "../../src/api/types/components.js";
import { ESPHomeAnsiLog } from "../../src/components/ansi-log.js";
import { ESPHomeLogParser } from "../../src/util/esphome-log-parser.js";
import { mount } from "../_dom.js";

const DOCS = {
  ethernet: {
    url: "https://esphome.io/components/ethernet",
    name: "Ethernet Component",
    description: "This ESPHome component enables wired Ethernet connections.",
  },
};

const BOOTLOADER =
  "[13:22:07][W][app:193]: Bootloader too old for OTA rollback. Flash via USB once to update the bootloader";
const ETHERNET = "[13:22:07][C][ethernet:495]: Ethernet:";
const PLAIN = "[13:22:07][I][main:042]: Some unremarkable status line";

async function mountLog(lines: string[]): Promise<ESPHomeAnsiLog> {
  const el = new ESPHomeAnsiLog();
  el.lines = lines;
  internals(el)._integrationDocs = DOCS;
  await mount(el);
  return el;
}

function root(el: ESPHomeAnsiLog): ShadowRoot {
  return el.shadowRoot!;
}

// Reach the component's private reactive fields without repeating the
// unknown-cast at every call site.
function internals(el: ESPHomeAnsiLog): {
  _integrationDocs: Record<string, IntegrationDoc>;
  _localize: (k: string, v?: Record<string, string | number>) => string;
  _docLinkCache: Map<string, unknown>;
} {
  return el as unknown as ReturnType<typeof internals>;
}

describe("ansi-log doc-link annotations", () => {
  let el: ESPHomeAnsiLog;

  beforeEach(async () => {
    el = await mountLog([BOOTLOADER, ETHERNET, PLAIN]);
  });

  it("adds a trailing info icon to an actionable line", () => {
    const doc = root(el).querySelector(".log-line--doc");
    expect(doc).not.toBeNull();
    expect(doc!.querySelector(".log-doc-icon")).not.toBeNull();
  });

  it("wraps only the [tag] token of a component line in a link", () => {
    const link = root(el).querySelector<HTMLButtonElement>(".log-tag-link");
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe("ethernet");
  });

  it("leaves an unrecognised line untouched", () => {
    const lines = Array.from(root(el).querySelectorAll(".log-line"));
    const plain = lines.find((l) => l.textContent?.includes("unremarkable"));
    expect(plain).toBeTruthy();
    expect(plain!.classList.contains("log-line--doc")).toBe(false);
    expect(plain!.querySelector(".log-doc-icon")).toBeNull();
    expect(plain!.querySelector(".log-tag-link")).toBeNull();
  });

  it("links the tag and shows the icon on an actionable component line", async () => {
    const crash =
      "[10:11:53.745][E][esp8266:171]: *** CRASH DETECTED ON PREVIOUS BOOT ***";
    const both = new ESPHomeAnsiLog();
    both.lines = [crash];
    internals(both)._integrationDocs = {
      esp8266: {
        url: "https://esphome.io/components/esp8266",
        name: "ESP8266 Platform",
        description: "",
      },
    };
    await mount(both);
    const doc = root(both).querySelector(".log-line--doc")!;
    expect(doc).not.toBeNull();
    expect(doc.querySelector(".log-doc-icon")).not.toBeNull();
    expect(doc.querySelector<HTMLButtonElement>(".log-tag-link")?.textContent).toBe(
      "esp8266"
    );
    expect(doc.querySelector(".log-line-text")!.textContent).toBe(crash);
  });

  it("titles the tag link with the catalog display name", async () => {
    const el = await mountLog([ETHERNET]);
    // The default localize stub echoes the key; substitute one that echoes
    // the interpolation so the displayName plumbing is observable.
    internals(el)._localize = (key, values) => String(values?.component ?? key);
    await el.updateComplete;
    const link = root(el).querySelector<HTMLButtonElement>(".log-tag-link")!;
    // The popover heading uses the same displayName field; the tooltip is
    // the DOM-visible surface to pin it on.
    expect(link.title).toBe("Ethernet Component");
  });

  it("keeps one cache entry per unique line across re-renders", async () => {
    const el = await mountLog([ETHERNET, PLAIN]);
    el.lines = [ETHERNET, PLAIN, BOOTLOADER];
    await el.updateComplete;
    el.lines = [ETHERNET, PLAIN, BOOTLOADER, ETHERNET];
    await el.updateComplete;
    expect(internals(el)._docLinkCache.size).toBe(3);
  });

  it("re-resolves cached lines when the integration docs map changes", async () => {
    const bare = new ESPHomeAnsiLog();
    bare.lines = [ETHERNET];
    await mount(bare);
    expect(root(bare).querySelector(".log-tag-link")).toBeNull();
    internals(bare)._integrationDocs = DOCS;
    await bare.updateComplete;
    expect(root(bare).querySelector(".log-tag-link")).not.toBeNull();
  });
});

describe("ansi-log doc links on the Web Serial pipeline", () => {
  // Web Serial lines skip the backend: raw UART text runs through
  // ESPHomeLogParser and gets a second-resolution [HH:MM:SS] stamp
  // prepended BEFORE the ANSI colour (streamSerialToDialog). Pin that
  // exact shape so serial sessions keep their links too.
  it("links the tag on a parser-stamped serial line", async () => {
    const parser = new ESPHomeLogParser();
    const uart = "\u001b[0;36m[C][ethernet:495]: Ethernet:\u001b[0m";
    const stamped = `[11:22:33]${parser.parseLine(uart)}`;
    const el = await mountLog([stamped]);
    const line = root(el).querySelector(".log-line")!;
    expect(line.querySelector<HTMLButtonElement>(".log-tag-link")?.textContent).toBe(
      "ethernet"
    );
    expect(line.textContent).toBe("[11:22:33][C][ethernet:495]: Ethernet:");
  });

  it("shows the icon on a parser-stamped serial crash banner", async () => {
    const parser = new ESPHomeLogParser();
    const uart =
      "\u001b[0;31m[E][esp8266:171]: *** CRASH DETECTED ON PREVIOUS BOOT ***\u001b[0m";
    const stamped = `[11:22:33]${parser.parseLine(uart)}`;
    const el = await mountLog([stamped]);
    expect(root(el).querySelector(".log-line--doc .log-doc-icon")).not.toBeNull();
  });
});

describe("ansi-log annotation selection-safety", () => {
  it("keeps the info icon outside the selectable text run", async () => {
    const el = await mountLog([BOOTLOADER]);
    const icon = root(el).querySelector(".log-doc-icon")!;
    // The icon is a sibling of the text span, never a descendant of it, so a
    // drag-select over the text can't pull it into the copy buffer.
    expect(icon.closest(".log-line-text")).toBeNull();
    // The icon carries no text, so the line's textContent is pure log output.
    expect(icon.textContent).toBe("");
    const text = root(el).querySelector(".log-line-text")!;
    expect(text.textContent).toBe(BOOTLOADER);
  });

  it("keeps the component tag as copyable text within the line", async () => {
    const el = await mountLog([ETHERNET]);
    const line = root(el).querySelector(".log-line")!;
    // The whole clean line (tag link text included) is the copied text.
    expect(line.textContent).toBe(ETHERNET);
  });

  it("preserves per-span ANSI colours while linking the tag", async () => {
    const raw = `\u001b[0;36m${ETHERNET}\u001b[0m \u001b[0;35mup\u001b[0m`;
    const el = await mountLog([raw]);
    const line = root(el).querySelector(".log-line")!;
    expect(line.querySelector<HTMLButtonElement>(".log-tag-link")?.textContent).toBe(
      "ethernet"
    );
    const styles = Array.from(line.querySelectorAll("span")).map(
      (s) => s.getAttribute("style") ?? ""
    );
    expect(styles.some((s) => s.includes("--ansi-fg-36"))).toBe(true);
    expect(styles.some((s) => s.includes("--ansi-fg-35"))).toBe(true);
    expect(line.textContent).toBe(`${ETHERNET} up`);
  });
});
