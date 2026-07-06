import { describe, expect, it } from "vitest";
import { stripAnsi } from "../../src/util/ansi-escapes.js";
import {
  type ComponentLogDocLink,
  type LogDocLink,
  resolveLogDocLink,
} from "../../src/util/log-doc-links.js";

const DOCS = {
  ethernet: "https://esphome.io/components/ethernet",
  i2c: "https://esphome.io/components/i2c",
  wifi: "https://esphome.io/components/wifi",
  sensor: "https://esphome.io/components/sensor",
};

function expectComponent(link: LogDocLink | undefined): ComponentLogDocLink {
  if (link?.kind !== "component") throw new Error("expected a component link");
  return link;
}

describe("resolveLogDocLink — actionable", () => {
  it("maps the bootloader warning to the OTA bootloader-update section", () => {
    const line =
      "[13:22:07][W][app:193]: Bootloader too old for OTA rollback. Flash via USB once to update the bootloader";
    expect(resolveLogDocLink(line, {})).toEqual({
      kind: "actionable",
      url: "https://esphome.io/components/ota/esphome/#updating-the-bootloader-on-esp32",
      body: "bootloader",
    });
  });

  it("maps the minimum_chip_revision hint to the ESP32 advanced-config page", () => {
    const line =
      '[13:22:07][W][app:168]: Chip rev >= 3.0 detected. Set minimum_chip_revision: "3.0" to save ~10KB IRAM';
    expect(resolveLogDocLink(line, {})?.body).toBe("chip_revision");
  });

  it("surfaces an esphome.io URL already embedded in the message", () => {
    const line =
      "[13:22:07][W][safe_mode:099]: Last reset was due to brownout - check your power supply! See https://esphome.io/guides/faq.html#brownout-detector-was-triggered";
    expect(resolveLogDocLink(line, {})).toEqual({
      kind: "actionable",
      url: "https://esphome.io/guides/faq.html#brownout-detector-was-triggered",
      body: "embedded",
    });
  });

  it("trims trailing sentence punctuation off an embedded URL", () => {
    const line = "[13:22:07][W][ota:099]: See https://esphome.io/components/ota/.";
    expect(resolveLogDocLink(line, {})?.url).toBe("https://esphome.io/components/ota/");
  });
});

describe("resolveLogDocLink — component", () => {
  it("links a simple tag to its component page and ranges the token", () => {
    const line = "[13:22:07][C][ethernet:495]: Ethernet:";
    const link = expectComponent(resolveLogDocLink(line, DOCS));
    expect(link.url).toBe(DOCS.ethernet);
    expect(link.component).toBe("ethernet");
    expect(link.clean).toBe(line);
    const { start, end } = link.tagRange;
    expect(line.slice(start, end)).toBe("ethernet");
  });

  it("resolves a dotted framework tag to the base component, ranging the whole tag", () => {
    const line = "[13:22:07][C][i2c.idf:092]: I2C Bus:";
    const link = expectComponent(resolveLogDocLink(line, DOCS));
    expect(link.url).toBe(DOCS.i2c);
    const { start, end } = link.tagRange;
    expect(line.slice(start, end)).toBe("i2c.idf");
  });

  it("strips a platform suffix (wifi_esp32 -> wifi)", () => {
    const line = "[13:22:07][C][wifi_esp32:482]: WiFi:";
    expect(resolveLogDocLink(line, DOCS)?.url).toBe(DOCS.wifi);
  });

  it("resolves a real-ESC ANSI line and ranges the tag in the clean text", () => {
    const raw = "\u001b[0;36m[13:22:07][C][ethernet:495]: Ethernet:\u001b[0m";
    const link = expectComponent(resolveLogDocLink(raw, DOCS));
    expect(link.component).toBe("ethernet");
    expect(link.clean).toBe("[13:22:07][C][ethernet:495]: Ethernet:");
    expect(link.clean).toBe(stripAnsi(raw));
    const { start, end } = link.tagRange;
    expect(link.clean.slice(start, end)).toBe("ethernet");
  });

  it("also strips the literal \\033 escape form the dashboard formatter emits", () => {
    const raw = "\\033[0;36m[13:22:07][C][ethernet:495]: Ethernet:\\033[0m";
    expect(stripAnsi(raw)).toBe("[13:22:07][C][ethernet:495]: Ethernet:");
    expect(expectComponent(resolveLogDocLink(raw, DOCS)).component).toBe("ethernet");
  });
});

describe("resolveLogDocLink — misses and safety", () => {
  it("returns undefined for an unknown component with no curated entry", () => {
    expect(resolveLogDocLink("[13:22:07][D][mycomp:1]: hello", DOCS)).toBeUndefined();
  });

  it("returns undefined for a non-log line with no embedded URL", () => {
    expect(resolveLogDocLink("Linking .pioenvs/firmware.elf", DOCS)).toBeUndefined();
  });

  it("rejects an unsafe (non-https / off-host) docs URL from the map", () => {
    const line = "[13:22:07][C][evil:1]: hi";
    expect(resolveLogDocLink(line, { evil: "javascript:alert(1)" })).toBeUndefined();
    expect(
      resolveLogDocLink(line, { evil: "https://evil.example.com/components/evil" })
    ).toBeUndefined();
  });

  it("prefers the curated actionable entry over a component match on the same tag", () => {
    const line =
      "[13:22:07][W][app:193]: Bootloader too old for OTA rollback. Flash via USB once";
    expect(
      resolveLogDocLink(line, { app: "https://esphome.io/components/app" })?.kind
    ).toBe("actionable");
  });
});
