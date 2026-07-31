import { describe, expect, it } from "vitest";
import {
  CRASH_BLOCK,
  CRASH_BLOCK_ESP8266,
  CRASH_BLOCK_NOISE_ONLY,
} from "../_crash-lines.js";
import {
  crashSymbol,
  isFilableTitle,
  MAX_TITLE_LENGTH,
  suggestIssueTitle,
} from "../../src/util/crash-report-title.js";
import { scrapeCrashData } from "../../src/util/crash-report.js";

const framesOf = (lines: string[]) => scrapeCrashData(lines).decodedFrames;

describe("crashSymbol", () => {
  const symbolOf = (lines: string[]) => crashSymbol(framesOf(lines));

  it("names the top frame, dropping its argument list and namespace", () => {
    expect(symbolOf(CRASH_BLOCK)).toBe("Application::setup");
  });

  it("reads esp8266's bare symbols, which carry no file:line", () => {
    // Its decoder emits `0xADDR: symbol` with nothing after it, and the
    // restart trampoline above the fault is skipped as machinery.
    expect(symbolOf(CRASH_BLOCK_ESP8266)).toBe("cnx_node_search");
  });

  it("returns nothing when every frame is panic or idle machinery", () => {
    // The alternative is a title naming the idle task, which is true of
    // any crash and so tells a triager nothing.
    expect(symbolOf(CRASH_BLOCK_NOISE_ONLY)).toBe("");
  });

  it("returns nothing when no frame decoded", () => {
    expect(crashSymbol([])).toBe("");
  });

  it("skips the abort machinery above the frame that threw", () => {
    expect(
      crashSymbol([
        "0x4038bc1c: panic_abort at /COMPONENT_ESP_SYSTEM_DIR/panic.c:491",
        "0x4038f9ec: __assert_func at /COMPONENT_NEWLIB_DIR/src/assert.c:34",
        "0x4212c628: __wrap___cxa_throw at /COMPONENT_CXX_DIR/cxx_exception_stubs.cpp:188",
        "0x42037b40: esphome::api::APIOverflowBuffer::enqueue_iov(iovec const*, int) at api.cpp:49",
      ])
    ).toBe("APIOverflowBuffer::enqueue_iov");
  });

  it("names the caller that allocated, not the allocator", () => {
    expect(
      crashSymbol([
        "0x401012b8: malloc",
        "0x402253f7: operator new(unsigned int)",
        "0x4021e950: esphome::mqtt::MQTTClientComponent::publish(std::string const&) at mqtt.cpp:12",
      ])
    ).toBe("MQTTClientComponent::publish");
  });

  it("keeps a templated symbol readable", () => {
    // Nested `<>` and `()` have to be stripped as balanced pairs; a plain
    // regex truncates mid-symbol and leaves `>>::operator`.
    expect(
      crashSymbol([
        "0x400dce02: esphome::FixedVector<std::pair<int, char> >::cleanup_(int) at fixed_vector.h:88",
      ])
    ).toBe("FixedVector::cleanup_");
  });

  it("strips a file:line tail carrying gcc's discriminator suffix", () => {
    expect(
      crashSymbol([
        "0x420144a4: esphome::modbus_controller::ModbusController::update_range_(esphome::modbus_controller::RegisterRange&) at /IDF_BUILD/../src/esphome/components/modbus_controller/modbus_controller.cpp:177 (discriminator 1)",
      ])
    ).toBe("ModbusController::update_range_");
  });

  it("keeps an angle-bracket operator's own name out of the template strip", () => {
    // `operator<<` would otherwise open a template depth that never closes,
    // swallow the rest of the symbol, and get repaired into `operator()` —
    // a title naming a different function than the one that crashed.
    expect(
      crashSymbol(["0x1: esphome::foo::Bar::operator<<(std::ostream&) at bar.cpp:1"])
    ).toBe("Bar::operator<<");
    expect(crashSymbol(["0x1: esphome::foo::Bar::operator->() at bar.cpp:1"])).toBe(
      "Bar::operator->"
    );
    expect(
      crashSymbol(["0x1: esphome::foo::Bar::operator<(Bar const&) at bar.cpp:1"])
    ).toBe("Bar::operator<");
  });

  it("keeps operator() named, which stripping argument lists would eat", () => {
    expect(
      crashSymbol([
        "0x400e4185: esphome::TemplateLambda<std::__cxx11::basic_string<char> >::operator()() at /IDF_BUILD/../src/esphome/core/template_lambda.h:41",
      ])
    ).toBe("TemplateLambda::operator()");
  });

  it("keeps a real frame whose template argument is a closure type", () => {
    // gcc demangles the closure into the argument list; `Bar<...>::run` is
    // an instantiated function, not the trampoline `_FUN` names.
    expect(
      crashSymbol([
        "0x1: esphome::foo::Bar<setup()::{lambda()#1}>::run() at bar.cpp:1",
        "0x2: esphome::foo::Baz::caller() at baz.cpp:2",
      ])
    ).toBe("Bar::run");
  });

  it("skips a lambda trampoline for the component that invoked it", () => {
    // `_FUN` and `{lambda(...)#N}` are the calling convention gcc emitted;
    // neither is code a triager can look up.
    expect(
      crashSymbol([
        "0x400dd565: setup()::{lambda(esphome::display::Display&)#1}::_FUN(esphome::display::Display&) at /TOOLCHAIN/bits/basic_string.h:651",
        "0x400dfc5e: esphome::display::DisplayWriter<esphome::display::Display>::call(esphome::display::Display&) const at /IDF_BUILD/../src/esphome/components/display/display.h:256",
      ])
    ).toBe("DisplayWriter::call");
  });

  it("names the frame once when the decoder repeats it per address", () => {
    expect(
      crashSymbol([
        "0x4010cbe0: esphome::ssd1306_base::SSD1306::fill(esphome::Color) at ssd1306.cpp:360",
        "0x4010cbdd: esphome::ssd1306_base::SSD1306::fill(esphome::Color) at ssd1306.cpp:360",
      ])
    ).toBe("SSD1306::fill");
  });
});

describe("suggestIssueTitle", () => {
  it("names the platform and the crash location", () => {
    // ESP32S3 reports as ESP32 — the platform table already folds variants.
    expect(suggestIssueTitle(framesOf(CRASH_BLOCK), "ESP32")).toBe(
      "ESP32: crash in Application::setup"
    );
  });

  it("uses each platform's own name, not just ESP32", () => {
    expect(suggestIssueTitle(framesOf(CRASH_BLOCK_ESP8266), "ESP8266")).toBe(
      "ESP8266: crash in cnx_node_search"
    );
  });

  it("says Device rather than the form's Other catch-all", () => {
    // "Other" is meaningful beside the form's platform field and says
    // nothing as a title prefix; nRF52 targets land there today.
    expect(suggestIssueTitle(framesOf(CRASH_BLOCK), "Other")).toBe(
      "Device: crash in Application::setup"
    );
  });

  it("falls back to Device when the platform is unknown", () => {
    expect(suggestIssueTitle(framesOf(CRASH_BLOCK), "")).toBe(
      "Device: crash in Application::setup"
    );
  });

  it("suggests nothing when no frame is worth naming", () => {
    expect(suggestIssueTitle(framesOf(CRASH_BLOCK_NOISE_ONLY), "")).toBe("");
  });

  it("leads with what the handler blamed, when it decoded a cause", () => {
    // Two crashes can stop in the same frame for unrelated reasons; the
    // frame alone would file both under one title.
    const frames = framesOf(CRASH_BLOCK);
    expect(suggestIssueTitle(frames, "ESP32", "Store access fault")).toBe(
      "ESP32: Store access fault in Application::setup"
    );
    expect(suggestIssueTitle(frames, "ESP32", "Task wdt")).toBe(
      "ESP32: Task wdt in Application::setup"
    );
  });

  it("falls back to a plain crash when no cause decoded", () => {
    expect(suggestIssueTitle(framesOf(CRASH_BLOCK), "ESP32", "")).toBe(
      "ESP32: crash in Application::setup"
    );
  });

  it("clamps its own output, so the field and the issue can't disagree", () => {
    // The input's maxlength bounds typing, not an assigned value, so an
    // unclamped suggestion would show in full and arrive truncated.
    const title = suggestIssueTitle([`0x1: Very${"Long".repeat(40)}::go`], "ESP32");
    expect(title).toHaveLength(MAX_TITLE_LENGTH);
    expect(title.endsWith("...")).toBe(true);
  });

  it("suggests a title its own gate accepts", () => {
    // The shortest possible suggestion still has to clear the filable floor,
    // or a seeded field would open already rejected.
    expect(isFilableTitle(suggestIssueTitle(["0x1: go"], "Host"))).toBe(true);
  });
});

describe("isFilableTitle", () => {
  it("rejects the one-word titles that say nothing", () => {
    for (const junk of ["", "   ", "crash", "help", "nothing", "n/a"]) {
      expect(isFilableTitle(junk)).toBe(false);
    }
  });

  it("accepts a short but specific title", () => {
    // The floor must not reject a real summary just for being brief.
    for (const title of ["Boot loop", "BLE crash loop", "SPI bus hangs"]) {
      expect(isFilableTitle(title)).toBe(true);
    }
  });
});
