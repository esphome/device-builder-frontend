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
import { CRASH_BLOCK, VALIDATED_CONFIG_YAML } from "../_crash-lines.js";

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
  installation: "Home Assistant Add-on",
};

const report = (overrides: Partial<CrashReport> = {}): CrashReport => ({
  scrape: scrapeCrashData(BUFFER),
  meta: META,
  configYaml: VALIDATED_CONFIG_YAML,
  userDescription: "Pressed the crash button in Home Assistant",
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

  it("preserves repeated [C] config lines verbatim (no folding)", () => {
    const scraped = scrapeCrashData([
      "Guru Meditation Error: crash",
      "[C][gpio:001]: Pin: GPIO2",
      "[C][gpio:001]: Pin: GPIO2",
      "[C][gpio:001]: Pin: GPIO2",
    ]);
    // Config dump keeps each line (folding is only for [W]/[E] spam).
    expect(scraped.configLines).toEqual([
      "[C][gpio:001]: Pin: GPIO2",
      "[C][gpio:001]: Pin: GPIO2",
      "[C][gpio:001]: Pin: GPIO2",
    ]);
  });

  it("reports a crash that scrolled out of the buffer", () => {
    const scrolled = scrapeCrashData(FILLER);
    expect(scrolled.crashFound).toBe(false);
    expect(scrolled.excerpt).toEqual([]);
  });

  // Pinned against real ol (esp32-poe-iso) output: the crash handler
  // replays the previous-boot crash through the logger with [E] tags,
  // and the inline decoder emits multi-line frames for inlined calls.
  it("handles the logger-replayed previous-boot crash report", () => {
    const scrape = scrapeCrashData([
      "[11:21:19.093][E][esp32.crash:332]: *** CRASH DETECTED ON PREVIOUS BOOT ***",
      "[11:21:19.096][E][esp32.crash:335]:   Reason: Fault - StoreProhibited",
      "[11:21:19.096][E][esp32.crash:340]:   PC:  0x40154830  (fault location)",
      "[11:21:19.167][E][esp32.crash:305]:   BT0: 0x4015482D  (backtrace)",
      "WARNING Decoded 0x4015482d: setup()::{lambda()#1}::_FUN() at configs/ol.yaml:52",
      " (inlined by) _FUN at configs/ol.yaml:53",
      "[11:21:19.211][E][esp32.crash:305]:   BT1: 0x40154879  (backtrace)",
      "WARNING Decoded 0x40154879: esphome::StatelessLambdaAction<>::play() at base_automation.h:247",
    ]);
    expect(scrape.crashFound).toBe(true);
    expect(scrape.decodedFrames).toEqual([
      "0x4015482d: setup()::{lambda()#1}::_FUN() at configs/ol.yaml:52\n" +
        "  (inlined by) _FUN at configs/ol.yaml:53",
      "0x40154879: esphome::StatelessLambdaAction<>::play() at base_automation.h:247",
    ]);
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
  it("leads with the user's context, then the decoded backtrace", () => {
    const text = buildFullReport(report());
    const order = [
      "## What happened",
      "## Decoded backtrace",
      "## Crash log",
      "## Warnings and errors",
      "## Config dump",
      "## Configuration (secrets redacted)",
      "## Environment",
    ].map((heading) => text.indexOf(heading));
    expect(order.every((index) => index !== -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain("Pressed the crash button in Home Assistant");
    expect(text).toContain("password: <removed>");
  });

  it("notes an unavailable config instead of a yaml section", () => {
    const text = buildFullReport(report({ configYaml: "" }));
    expect(text).toContain("could not be validated");
    expect(text).not.toContain("```yaml");
  });

  it("fences the user description so a stray backtick run can't hide sections", () => {
    const text = buildFullReport(
      report({ userDescription: "ran this:\n```\ncode\n```\nthen it crashed" })
    );
    // The description is fenced wider than its own ``` run, so every
    // heading below "What happened" survives intact.
    expect(text).toContain("````");
    expect(text).toContain("ran this:");
    expect(text).toContain("## Decoded backtrace");
    expect(text).toContain("## Environment");
  });

  it("widens the code fence when content contains a backtick run", () => {
    // A config with a ``` run must not close the fence early.
    const text = buildFullReport(report({ configYaml: "note: |\n  ``` not a fence" }));
    expect(text).toContain("````yaml");
    expect(text).toContain("note: |\n  ``` not a fence");
  });
});

describe("buildIssueUrl", () => {
  const params = (r: CrashReport) => new URL(buildIssueUrl(r).url).searchParams;

  it("prefills the text fields, config into the YAML Config box", () => {
    const p = params(report());
    expect(p.get("template")).toBe("bug_report.yml");
    expect(p.get("version")).toBe("2026.6.4");
    expect(p.get("component_name")).toBe("wifi");
    expect(p.get("title")).toContain("Guru Meditation Error");
    expect(p.get("problem")).toContain("Pressed the crash button in Home Assistant");
    expect(p.get("problem")).toContain("Decoded backtrace:");
    expect(p.get("problem")).toContain("0x400d9150: esphome::Application::setup()");
    expect(p.get("logs")).toContain("Backtrace: 0x400d9150");
    // The whole sanitized config lands in the form's config field.
    expect(p.get("config")).toBe(VALIDATED_CONFIG_YAML);
  });

  it("surfaces platform and installation in problem (dropdowns can't prefill)", () => {
    const p = params(report());
    // GitHub ignores URL prefill on dropdown fields, so they are NOT set.
    expect(p.has("platform")).toBe(false);
    expect(p.has("installation")).toBe(false);
    // The values ride in the problem text where the maintainer sees them.
    expect(p.get("problem")).toContain("Platform: ESP32");
    expect(p.get("problem")).toContain("Installation: Home Assistant Add-on");
  });

  it("reports complete when everything fit", () => {
    expect(buildIssueUrl(report()).complete).toBe(true);
  });

  it("fences the description in problem so a backtick run can't hide the trace", () => {
    const p = params(report({ userDescription: "ran:\n```\ncode\n```\ncrash" }));
    // The prose is fenced wider than its own ``` run, so the facts and the
    // decoded backtrace that follow it in the problem field survive.
    expect(p.get("problem")).toContain("ran:");
    expect(p.get("problem")).toContain("Decoded backtrace:");
  });

  it("keeps the URL under budget even with a huge user description", () => {
    const result = buildIssueUrl(report({ userDescription: "x".repeat(20000) }));
    expect(result.url.length).toBeLessThanOrEqual(8000);
    expect(result.complete).toBe(false);
    expect(new URL(result.url).searchParams.get("problem")).toContain("truncated");
  });

  it("stays under budget with paren/!-heavy content (form-encoding cost)", () => {
    // encodeURIComponent leaves ( ) ! ~ ' as 1 char but URLSearchParams
    // encodes them as 3 — a real budget hazard for C++ backtraces and
    // !lambda/!secret YAML. The real URL must still be under the cap.
    const heavy =
      "esphome::Callback<void ()>::create()::{lambda(void*)#1}::operator()() !~'";
    const result = buildIssueUrl(
      report({
        userDescription: heavy.repeat(120),
        configYaml: `esphome:\n${`  x: ${heavy}\n`.repeat(120)}`,
        scrape: scrapeCrashData([
          "Guru Meditation Error: crash",
          ...Array.from({ length: 60 }, () => `  ${heavy}`),
        ]),
      })
    );
    expect(result.url.length).toBeLessThanOrEqual(8000);
  });

  it("omits the platform fact when unknown", () => {
    const p = params(report({ meta: { ...META, installation: "", targetPlatform: "" } }));
    expect(p.get("problem")).not.toContain("Platform:");
    expect(p.get("problem")).not.toContain("Installation:");
  });

  it("packs only non-duplicated sections into additional", () => {
    const p = params(report());
    const additional = p.get("additional") ?? "";
    expect(additional).toContain("Warnings and errors:");
    // Environment already rides in `problem`; don't repeat it under the
    // tight URL budget.
    expect(additional).not.toContain("Environment:");
    expect(p.get("problem")).toContain("Platform: ESP32");
  });

  it("stays under budget, truncating config then logs, and reports incomplete", () => {
    const noisy = [
      ...Array.from(
        { length: 200 },
        (_, i) => `[12:00:00][I][app:029]: filler context line ${i} ${"x".repeat(400)}`
      ),
      ...CRASH_BLOCK,
    ];
    const bigConfig = Array.from(
      { length: 2000 },
      (_, i) => `  key_${i}: value_${i}`
    ).join("\n");
    const result = buildIssueUrl(
      report({ scrape: scrapeCrashData(noisy), configYaml: `esphome:\n${bigConfig}` })
    );
    expect(result.url.length).toBeLessThanOrEqual(8000);
    expect(result.complete).toBe(false);
    const p = new URL(result.url).searchParams;
    expect(p.get("logs")).toContain("Guru Meditation Error");
    expect(p.get("config")).toContain("config truncated");
  });
});
