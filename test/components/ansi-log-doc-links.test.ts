/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from "vitest";
import { ESPHomeAnsiLog } from "../../src/components/ansi-log.js";
import { mount } from "../_dom.js";

const DOCS = { ethernet: "https://esphome.io/components/ethernet" };

const BOOTLOADER =
  "[13:22:07][W][app:193]: Bootloader too old for OTA rollback. Flash via USB once to update the bootloader";
const ETHERNET = "[13:22:07][C][ethernet:495]: Ethernet:";
const PLAIN = "[13:22:07][I][main:042]: Some unremarkable status line";

async function mountLog(lines: string[]): Promise<ESPHomeAnsiLog> {
  const el = new ESPHomeAnsiLog();
  el.lines = lines;
  (el as unknown as { _integrationDocs: Record<string, string> })._integrationDocs = DOCS;
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
