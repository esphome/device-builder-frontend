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
    ["rp2.crash", "[12:31:55][E][rp2.crash:103]"],
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

  it("maps the CLI wifi-AP validation warning to the captive portal docs", () => {
    const line =
      "\\033[33mWARNING WiFi AP is configured but neither captive_portal nor web_server is enabled. The AP will not be usable for configuration or monitoring. Add 'captive_portal:' or 'web_server:' to your configuration.\\033[0m";
    const links = resolveLogDocLink(line, {});
    expect(links?.actionable).toEqual({
      kind: "actionable",
      url: "https://esphome.io/components/captive_portal/",
      body: "wifi_ap_no_portal",
    });
    // The icon inherits the container colour, so a tag-less CLI line still
    // reports its level for the renderer to colour it like the warning text.
    expect(links?.level).toBe("W");
  });

  it("ignores an uncurated CLI warning line", () => {
    const line = "\\033[33mWARNING Something else happened during validation\\033[0m";
    expect(resolveLogDocLink(line, {})).toBeUndefined();
  });
});

describe("resolveLogDocLink — tcp_buffer", () => {
  const ESP32 = "ESP32";
  const NETWORK_URL = "https://esphome.io/components/network/#configuration-variables";
  const NOTIFY_DROP =
    "[10:24:27.031][W][bluetooth_connection:376]: [0] [AA:BB:CC:DD:EE:FF] Failed to send notify data response, handle 0x002A";

  it.each([
    [
      "api.connection",
      "[10:24:27.031][W][api.connection:2066]: Action response dropped, TCP buffer full",
    ],
    ["api", "[10:24:27.031][W][api:127]: Disconnect request dropped, TCP buffer full"],
    [
      "voice_assistant",
      "[10:24:27.031][W][voice_assistant:753]: Stop request dropped, TCP buffer full",
    ],
    [
      "zwave_proxy",
      "[10:24:27.031][W][zwave_proxy:334]: Home ID notification dropped, TCP buffer full",
    ],
    [
      "bluetooth_proxy",
      "[10:24:27.031][W][bluetooth_proxy:132]: GATT read reply for AABBCCDDEEFF deferred, TCP buffer full",
    ],
    [
      "bluetooth_connection",
      "[10:24:27.031][W][bluetooth_connection:283]: [0] [AA:BB:CC:DD:EE:FF] GATT reply for handle 0x002A deferred, TCP buffer full",
    ],
  ])(
    "maps a %s 'TCP buffer full' warning to the network config docs on ESP32",
    (_tag, line) => {
      expect(resolveLogDocLink(line, {}, ESP32)?.actionable).toEqual({
        kind: "actionable",
        url: NETWORK_URL,
        body: "tcp_buffer",
      });
    }
  );

  it.each([
    ["notify drop with handle", NOTIFY_DROP],
    [
      "notify drop without handle (older firmware)",
      "[10:24:27.031][W][bluetooth_connection:376]: [0] [AA:BB:CC:DD:EE:FF] Failed to send notify data response",
    ],
    [
      "read response",
      "[10:24:27.031][W][bluetooth_connection:333]: [0] [AA:BB:CC:DD:EE:FF] Failed to send read response",
    ],
    [
      "displaced GATT reply",
      "[10:24:27.031][W][bluetooth_connection:288]: [0] [AA:BB:CC:DD:EE:FF] GATT reply for handle 0x002A dropped for handle 0x002C",
    ],
    [
      "abandoned GATT reply",
      "[10:24:27.031][W][bluetooth_connection:308]: [0] [AA:BB:CC:DD:EE:FF] GATT reply for handle 0x002A undeliverable, abandoning",
    ],
    [
      "services done retry",
      "[10:24:27.031][W][bluetooth_connection:459]: [0] [AA:BB:CC:DD:EE:FF] Failed to send services done, retrying",
    ],
    [
      "services done abandon",
      "[10:24:27.031][W][bluetooth_connection:470]: [0] [AA:BB:CC:DD:EE:FF] Services done undeliverable, abandoning",
    ],
    [
      "displaced proxy reply",
      "[10:24:27.031][W][bluetooth_proxy:136]: GATT error reply for AABBCCDDEEFF dropped, displaced by AABBCCDDEE00",
    ],
    [
      "queued keepalive ping",
      "[10:24:27.031][W][api.connection:370]: Buffer full, ping queued",
    ],
    [
      "voice assistant start request",
      "[10:24:27.031][W][voice_assistant:366]: Could not request start",
    ],
  ])("maps the same-cause %s warning on ESP32", (_what, line) => {
    expect(resolveLogDocLink(line, {}, ESP32)?.actionable?.body).toBe("tcp_buffer");
  });

  it.each([
    ["no platform", undefined],
    ["an empty platform", ""],
    ["ESP8266", "ESP8266"],
    ["rp2", "rp2"],
  ])("does not fire with %s (the option is ESP32-only)", (_what, platform) => {
    expect(resolveLogDocLink(NOTIFY_DROP, {}, platform)?.actionable).toBeUndefined();
  });

  it("prefix-matches ESP32 variants", () => {
    expect(resolveLogDocLink(NOTIFY_DROP, {}, "esp32s3")?.actionable?.body).toBe(
      "tcp_buffer"
    );
  });

  it("does not match the verbose notify-drop variant", () => {
    const line =
      "[10:24:27.031][V][bluetooth_connection:379]: [0] [AA:BB:CC:DD:EE:FF] Failed to send notify data response, handle 0x002A";
    expect(resolveLogDocLink(line, {}, ESP32)?.actionable).toBeUndefined();
  });

  it("does not match an unrelated bluetooth_connection warning", () => {
    const line =
      "[10:24:27.031][W][bluetooth_connection:058]: [0] [AA:BB:CC:DD:EE:FF] connect failed, err=133";
    expect(resolveLogDocLink(line, {}, ESP32)?.actionable).toBeUndefined();
  });

  it("leaves ungated entries alone when a platform is passed", () => {
    const line =
      "[13:22:07][W][app:193]: Bootloader too old for OTA rollback. Flash via USB once to update the bootloader";
    expect(resolveLogDocLink(line, {}, "ESP8266")?.actionable?.body).toBe("bootloader");
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
