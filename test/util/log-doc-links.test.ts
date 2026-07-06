import { describe, expect, it } from "vitest";
import { stripAnsi } from "../../src/util/ansi-escapes.js";
import {
  type ComponentLogDocLink,
  type LogDocLinks,
  resolveLogDocLink,
} from "../../src/util/log-doc-links.js";

const ETH_DESC =
  "This ESPHome component enables wired Ethernet connections for ESP32 and RP2040 boards.";

const DOCS = {
  ethernet: {
    url: "https://esphome.io/components/ethernet",
    name: "Ethernet Component",
    description: ETH_DESC,
  },
  i2c: { url: "https://esphome.io/components/i2c", name: "I2C Bus", description: "" },
  wifi: {
    url: "https://esphome.io/components/wifi",
    name: "WiFi Component",
    description: "",
  },
  sensor: {
    url: "https://esphome.io/components/sensor",
    name: "sensor",
    description: "",
  },
};

function expectComponent(links: LogDocLinks | undefined): ComponentLogDocLink {
  if (!links?.component) throw new Error("expected a component link");
  return links.component;
}

describe("resolveLogDocLink — actionable", () => {
  it("maps the bootloader warning to the OTA bootloader-update section", () => {
    const line =
      "[13:22:07][W][app:193]: Bootloader too old for OTA rollback. Flash via USB once to update the bootloader";
    expect(resolveLogDocLink(line, {})).toEqual({
      actionable: {
        kind: "actionable",
        url: "https://esphome.io/components/ota/esphome/#updating-the-bootloader-on-esp32",
        body: "bootloader",
      },
      level: "W",
    });
  });

  it("maps the minimum_chip_revision hint to the ESP32 advanced-config page", () => {
    const line =
      '[13:22:07][W][app:168]: Chip rev >= 3.0 detected. Set minimum_chip_revision: "3.0" to save ~10KB IRAM';
    expect(resolveLogDocLink(line, {})?.actionable?.body).toBe("chip_revision");
  });

  it("maps the sram1_as_iram hint to the ESP32 advanced-config page", () => {
    const line =
      "[10:24:27.031][W][app:198]: Bootloader supports SRAM1 as IRAM (+40KB). Set sram1_as_iram: true under esp32 > framework > advanced";
    expect(resolveLogDocLink(line, {})?.actionable).toEqual({
      kind: "actionable",
      url: "https://esphome.io/components/esp32/#advanced-configuration",
      body: "sram1_as_iram",
    });
  });

  it("matches the combined bootloader-and-SRAM1 variant as the bootloader entry", () => {
    const line =
      "[10:24:27.031][W][app:190]: Bootloader too old for OTA rollback and SRAM1 as IRAM (+40KB). Flash via USB once to update the bootloader";
    expect(resolveLogDocLink(line, {})?.actionable?.body).toBe("bootloader");
  });

  it("surfaces an esphome.io URL already embedded in the message", () => {
    const line =
      "[13:22:07][W][safe_mode:099]: Last reset was due to brownout - check your power supply! See https://esphome.io/guides/faq.html#brownout-detector-was-triggered";
    expect(resolveLogDocLink(line, {})?.actionable).toEqual({
      kind: "actionable",
      url: "https://esphome.io/guides/faq.html#brownout-detector-was-triggered",
      body: "embedded",
    });
  });

  it("trims trailing sentence punctuation off an embedded URL", () => {
    const line = "[13:22:07][W][ota:099]: See https://esphome.io/components/ota/.";
    expect(resolveLogDocLink(line, {})?.actionable?.url).toBe(
      "https://esphome.io/components/ota/"
    );
  });

  it.each([
    ["esp32.crash", "[12:31:55][E][esp32.crash:221]"],
    ["esp8266", "[09:28:39.132][E][esp8266:171]"],
    ["rp2040.crash", "[12:31:55][E][rp2040.crash:103]"],
  ])("maps the %s crash banner to the troubleshooting guide", (_tag, prefix) => {
    const line = `${prefix}: *** CRASH DETECTED ON PREVIOUS BOOT ***`;
    expect(resolveLogDocLink(line, {})?.actionable).toEqual({
      kind: "actionable",
      url: "https://esphome.io/guides/troubleshooting/",
      body: "crash",
    });
  });

  it("carries both facets when the crash tag is also a catalogued component", () => {
    const line =
      "[09:28:39.132][E][esp8266:171]: *** CRASH DETECTED ON PREVIOUS BOOT ***";
    const links = resolveLogDocLink(line, {
      esp8266: {
        url: "https://esphome.io/components/esp8266",
        name: "ESP8266 Platform",
        description: "",
      },
    });
    expect(links?.actionable?.url).toBe("https://esphome.io/guides/troubleshooting/");
    expect(links?.component?.url).toBe("https://esphome.io/components/esp8266");
    expect(links?.component?.component).toBe("esp8266");
  });

  it.each([
    [
      "slow_component",
      "[10:24:27.031][W][component:473]: sensor.dht took a long time for an operation (67 ms), max is 30 ms",
      "https://esphome.io/guides/troubleshooting/#took-a-long-time-for-an-operation-warning",
    ],
    [
      "wifi_reconnect",
      "[10:24:27.031][W][wifi:810]: Connection lost; reconnecting",
      "https://esphome.io/guides/faq/#my-node-keeps-reconnecting-randomly",
    ],
    [
      "wifi_reconnect",
      "[10:24:27.031][W][wifi:852]: Disconnected ssid='mynet' bssid=aa:bb reason='Beacon Timeout'",
      "https://esphome.io/guides/faq/#my-node-keeps-reconnecting-randomly",
    ],
    [
      "boot_loop",
      "[10:24:27.031][W][safe_mode:085]: Last reset too quick; invoke in 5 restarts",
      "https://esphome.io/guides/troubleshooting/",
    ],
    [
      "ota_rollback",
      "[10:24:27.031][W][safe_mode:094]: OTA rollback detected! Rolled back from partition 'ota_1'",
      "https://esphome.io/guides/troubleshooting/",
    ],
    [
      "nvs",
      "[10:24:27.031][W][preferences:100]: nvs_open failed: ESP_ERR_NVS_NOT_INITIALIZED - NVS unavailable",
      "https://esphome.io/guides/faq/#component-states-not-restored-after-reboot",
    ],
    [
      "ble_slots",
      "[10:24:27.031][W][bluetooth_proxy:175]: No free connections available",
      "https://esphome.io/components/bluetooth_proxy/#how-active-connections-work",
    ],
  ])("maps the issue-mined %s entry", (body, line, url) => {
    expect(resolveLogDocLink(line, {})?.actionable).toEqual({
      kind: "actionable",
      url,
      body,
    });
  });

  it("does not match the INFO wifi roaming variant", () => {
    const line =
      "[10:24:27.031][I][wifi:847]: Disconnected ssid='mynet' reason='Station Roaming'";
    expect(resolveLogDocLink(line, {})?.actionable).toBeUndefined();
  });

  it("excludes roaming even if esphome ever logs it at W", () => {
    const line =
      "[10:24:27.031][W][wifi:847]: Disconnected ssid='mynet' reason='Station Roaming'";
    expect(resolveLogDocLink(line, {})?.actionable).toBeUndefined();
  });

  it("does not match an ordinary component-tag line", () => {
    const line = "[10:24:27.031][W][component:200]: some other warning";
    expect(resolveLogDocLink(line, {})).toBeUndefined();
  });

  it("leaves the crash detail lines (Reason/PC) to the component resolver", () => {
    const line =
      "[09:28:39.132][E][esp8266:186]:   Reason: Soft WDT - Level1Int (exccause=4)";
    expect(resolveLogDocLink(line, {})).toBeUndefined();
  });
});

describe("resolveLogDocLink — component", () => {
  it("links a simple tag to its component page and ranges the token", () => {
    const line = "[13:22:07][C][ethernet:495]: Ethernet:";
    const links = resolveLogDocLink(line, DOCS);
    expect(links?.actionable).toBeUndefined();
    const link = expectComponent(links);
    expect(link.url).toBe(DOCS.ethernet.url);
    expect(link.displayName).toBe("Ethernet Component");
    expect(link.description).toBe(ETH_DESC);
    expect(link.component).toBe("ethernet");
    expect(link.clean).toBe(line);
    const { start, end } = link.tagRange;
    expect(line.slice(start, end)).toBe("ethernet");
  });

  it("resolves a dotted framework tag to the base component, ranging the whole tag", () => {
    const line = "[13:22:07][C][i2c.idf:092]: I2C Bus:";
    const link = expectComponent(resolveLogDocLink(line, DOCS));
    expect(link.url).toBe(DOCS.i2c.url);
    const { start, end } = link.tagRange;
    expect(line.slice(start, end)).toBe("i2c.idf");
  });

  it("prefers the exact dotted tag over the before-the-dot fallback", () => {
    // The backend map carries qualified aliases for platform log tags
    // (esphome.ota is the ota.esphome platform, not the esphome core
    // component); the exact-tag candidate must win over the prefix.
    const line = "[13:22:07][C][esphome.ota:108]: Over-The-Air updates:";
    const link = expectComponent(
      resolveLogDocLink(line, {
        esphome: {
          url: "https://esphome.io/components/esphome",
          name: "ESPHome Core",
          description: "",
        },
        "esphome.ota": {
          url: "https://esphome.io/components/ota/esphome",
          name: "ESPHome OTA Platform",
          description: "",
        },
      })
    );
    expect(link.url).toBe("https://esphome.io/components/ota/esphome");
    expect(link.component).toBe("esphome.ota");
  });

  it("strips a platform suffix (wifi_esp32 -> wifi)", () => {
    const line = "[13:22:07][C][wifi_esp32:482]: WiFi:";
    expect(resolveLogDocLink(line, DOCS)?.component?.url).toBe(DOCS.wifi.url);
  });

  it("links the bare-domain tag of an [S] state line", () => {
    const line = "[10:18:17.439][S][sensor]: 'Ethernet Uptime' >> 68523 s";
    const link = expectComponent(resolveLogDocLink(line, DOCS));
    expect(link.url).toBe(DOCS.sensor.url);
    const { start, end } = link.tagRange;
    expect(line.slice(start, end)).toBe("sensor");
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
    expect(
      resolveLogDocLink(line, {
        evil: { url: "javascript:alert(1)", name: "evil", description: "" },
      })
    ).toBeUndefined();
    expect(
      resolveLogDocLink(line, {
        evil: {
          url: "https://evil.example.com/components/evil",
          name: "evil",
          description: "",
        },
      })
    ).toBeUndefined();
  });

  it("keeps the component facet alongside a curated actionable match", () => {
    const line =
      "[13:22:07][W][app:193]: Bootloader too old for OTA rollback. Flash via USB once";
    const links = resolveLogDocLink(line, {
      app: {
        url: "https://esphome.io/components/app",
        name: "Native API Something",
        description: "",
      },
    });
    expect(links?.actionable?.body).toBe("bootloader");
    expect(links?.component?.url).toBe("https://esphome.io/components/app");
  });
});
