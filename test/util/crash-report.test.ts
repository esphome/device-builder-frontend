import { describe, expect, it } from "vitest";
import {
  type CrashReport,
  buildFullReport,
  buildIssueUrl,
  distillValidatedConfig,
  inferComponentName,
  issuePlatform,
  scrapeCrashData,
} from "../../src/util/crash-report.js";
import { CRASH_BLOCK } from "../_crash-lines.js";

const FILLER = Array.from(
  { length: 40 },
  (_, i) => `[12:00:00][I][app:029]: loop iteration ${i}`
);

const BUFFER = [
  ...FILLER,
  // Continuation lines arrive with the entry's prefix re-applied (the
  // log parsers on both transports do this before lines hit the buffer).
  "[12:00:01][C][wifi:001]: WiFi:",
  "[12:00:01][C][wifi:001]:   SSID: 'mynetwork'",
  "[12:00:02][W][component:214]: Component wifi took a long time (128 ms)",
  "[12:00:03][W][component:214]: Component wifi took a long time (128 ms)",
  "[12:00:04][W][component:214]: Component wifi took a long time (128 ms)",
  "[12:00:05][E][uart:123]: Reading from UART timed out",
  ...CRASH_BLOCK,
  "[12:00:10][I][app:029]: booted again",
];

const META = {
  deviceName: "Small Garage",
  configuration: "smallgarage.yaml",
  esphomeVersion: "2026.6.4",
  deployedVersion: "2026.6.2",
  dashboardVersion: "1.6.1",
  targetPlatform: "ESP32S3",
  board: "esp32dev",
  isHaAddon: true,
};

const report = (overrides: Partial<CrashReport> = {}): CrashReport => ({
  scrape: scrapeCrashData(BUFFER),
  meta: META,
  configYaml: "esphome:\n  name: smallgarage\nwifi:\n  password: <removed>",
  ...overrides,
});

describe("scrapeCrashData", () => {
  const scrape = scrapeCrashData(BUFFER);

  it("finds the crash and bounds the excerpt at the reboot marker", () => {
    expect(scrape.crashFound).toBe(true);
    expect(scrape.excerpt[scrape.excerpt.length - 1]).toBe("Rebooting...");
    // Context lines before the banner ride along...
    expect(scrape.excerpt).toContain("[E][uart:123]: Reading from UART timed out");
    // ...but the post-reboot line does not.
    expect(scrape.excerpt).not.toContain("[I][app:029]: booted again");
  });

  it("extracts the inline-decoded frames", () => {
    expect(scrape.decodedFrames).toEqual([
      "0x400d9150: esphome::Application::setup() at esphome/core/application.cpp:59",
      "0x400da73c: esphome::wifi::WiFiComponent::loop() at esphome/components/wifi/wifi_component.cpp:100",
    ]);
  });

  it("collects [W]/[E] lines, folding immediate repeats", () => {
    expect(scrape.warnings).toEqual([
      "[W][component:214]: Component wifi took a long time (128 ms) (x3)",
      "[E][uart:123]: Reading from UART timed out",
    ]);
  });

  it("collects multi-line [C] records (continuations carry the re-applied prefix)", () => {
    expect(scrape.configLines).toEqual([
      "[C][wifi:001]: WiFi:",
      "[C][wifi:001]:   SSID: 'mynetwork'",
    ]);
  });

  it("reports a crash that scrolled out of the buffer", () => {
    const scrolled = scrapeCrashData(FILLER);
    expect(scrolled.crashFound).toBe(false);
    expect(scrolled.excerpt).toEqual([]);
  });
});

describe("distillValidatedConfig", () => {
  it("keeps the YAML and drops CLI log records, timestamped or not", () => {
    expect(
      distillValidatedConfig([
        "\\033[32mINFO ESPHome 2026.6.4\\033[0m",
        "12:34:56 INFO Reading configuration...",
        "esphome:",
        "  name: smallgarage",
        "\\033[32mINFO Configuration is valid!\\033[0m",
      ])
    ).toBe("esphome:\n  name: smallgarage");
  });
});

describe("issuePlatform / inferComponentName", () => {
  it("maps target platforms onto the form's dropdown values", () => {
    expect(issuePlatform("ESP32S3")).toBe("ESP32");
    expect(issuePlatform("esp32")).toBe("ESP32");
    expect(issuePlatform("ESP8266")).toBe("ESP8266");
    expect(issuePlatform("BK72XX")).toBe("BK72XX");
    expect(issuePlatform("nrf52840")).toBe("Other");
    expect(issuePlatform("")).toBe("");
  });

  it("names the first component-owned decoded frame", () => {
    expect(inferComponentName(report().scrape.decodedFrames)).toBe("wifi");
    expect(inferComponentName(["0x1: main at src/main.cpp:1"])).toBe("");
  });
});

describe("buildFullReport", () => {
  it("orders sections decoded-backtrace-first", () => {
    const text = buildFullReport(report());
    const order = [
      "## Decoded backtrace",
      "## Crash log",
      "## Warnings and errors",
      "## Config dump",
      "## Configuration (secrets redacted)",
      "## Environment",
    ].map((heading) => text.indexOf(heading));
    expect(order.every((index) => index !== -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain("password: <removed>");
  });

  it("notes an unavailable config instead of a yaml section", () => {
    const text = buildFullReport(report({ configYaml: "" }));
    expect(text).toContain("could not be validated");
    expect(text).not.toContain("```yaml");
  });
});

describe("buildIssueUrl", () => {
  const params = (r: CrashReport, mode: "clipboard" | "download" = "clipboard") =>
    new URL(buildIssueUrl(r, mode)).searchParams;

  it("prefills the form fields and never sets config", () => {
    const p = params(report());
    expect(p.get("template")).toBe("bug_report.yml");
    expect(p.get("version")).toBe("2026.6.4");
    expect(p.get("installation")).toBe("Home Assistant Add-on");
    expect(p.get("platform")).toBe("ESP32");
    expect(p.get("component_name")).toBe("wifi");
    expect(p.get("title")).toContain("Guru Meditation Error");
    expect(p.get("problem")).toContain("Decoded backtrace:");
    expect(p.get("problem")).toContain("0x400d9150: esphome::Application::setup()");
    expect(p.get("logs")).toContain("Backtrace: 0x400d9150");
    expect(p.has("config")).toBe(false);
  });

  it("omits installation outside the add-on and unknown platforms", () => {
    const p = params(report({ meta: { ...META, isHaAddon: false, targetPlatform: "" } }));
    expect(p.has("installation")).toBe(false);
    expect(p.has("platform")).toBe(false);
  });

  it("tells the user where the full report went", () => {
    expect(params(report(), "clipboard").get("additional")).toContain("clipboard");
    expect(params(report(), "download").get("additional")).toContain("markdown file");
  });

  it("stays under the URL budget, dropping context before the crash block", () => {
    const noisy = [
      ...Array.from(
        { length: 200 },
        (_, i) => `[12:00:00][I][app:029]: filler context line ${i} ${"x".repeat(400)}`
      ),
      ...CRASH_BLOCK,
    ];
    const r = report({ scrape: scrapeCrashData(noisy) });
    const url = buildIssueUrl(r, "clipboard");
    expect(url.length).toBeLessThanOrEqual(6000);
    const logs = new URL(url).searchParams.get("logs") ?? "";
    expect(logs).toContain("Guru Meditation Error");
    expect(logs).toContain("trimmed");
  });
});
