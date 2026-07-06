/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { IntegrationDoc } from "../../src/api/types/components.js";
import { ESPHomeAnsiLog } from "../../src/components/ansi-log.js";
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
  (
    el as unknown as { _integrationDocs: Record<string, IntegrationDoc> }
  )._integrationDocs = DOCS;
  await mount(el);
  return el;
}

function root(el: ESPHomeAnsiLog): ShadowRoot {
  return el.shadowRoot!;
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
    (
      both as unknown as { _integrationDocs: Record<string, IntegrationDoc> }
    )._integrationDocs = {
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
    (
      el as unknown as {
        _localize: (k: string, v?: Record<string, string | number>) => string;
      }
    )._localize = (key, values) => String(values?.component ?? key);
    await el.updateComplete;
    const link = root(el).querySelector<HTMLButtonElement>(".log-tag-link")!;
    // The popover heading uses the same displayName field; the tooltip is
    // the DOM-visible surface to pin it on.
    expect(link.title).toBe("Ethernet Component");
  });

  it("re-resolves cached lines when the integration docs map changes", async () => {
    const bare = new ESPHomeAnsiLog();
    bare.lines = [ETHERNET];
    await mount(bare);
    expect(root(bare).querySelector(".log-tag-link")).toBeNull();
    (
      bare as unknown as { _integrationDocs: Record<string, IntegrationDoc> }
    )._integrationDocs = DOCS;
    await bare.updateComplete;
    expect(root(bare).querySelector(".log-tag-link")).not.toBeNull();
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
