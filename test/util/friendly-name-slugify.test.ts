import { describe, expect, it } from "vitest";
import { friendlyNameSlugify } from "../../src/util/friendly-name-slugify.js";

describe("friendlyNameSlugify", () => {
  it("matches upstream output for plain ASCII names", () => {
    expect(friendlyNameSlugify("Kitchen Sensor")).toBe("kitchen-sensor");
    expect(friendlyNameSlugify("kitchen-sensor")).toBe("kitchen-sensor");
  });

  it("converts underscores to hyphens (matches legacy behaviour)", () => {
    // Regression: the previous ``[^a-z0-9-]`` regex stripped ``_``
    // entirely instead of mapping it to ``-`` like upstream's
    // ``friendly_name_slugify`` does. Pin the legacy parity.
    expect(friendlyNameSlugify("test_web_server_ota_esp32")).toBe(
      "test-web-server-ota-esp32",
    );
  });

  it("strips diacritics", () => {
    // Upstream's ``strip_accents`` runs through ``unicodedata.normalize("NFD")``
    // and drops combining marks. Mirror that so ``Küche`` and ``café``
    // produce the same slugs the legacy dashboard would have.
    expect(friendlyNameSlugify("Küche")).toBe("kuche");
    expect(friendlyNameSlugify("Café")).toBe("cafe");
    expect(friendlyNameSlugify("Mañana")).toBe("manana");
  });

  it("collapses runs of separators and trims ends", () => {
    // Upstream:
    //   "  My  Cool - Device  " → strip+lower+space-to-_ → "__my__cool___device__"
    //   collapse __ → "_my_cool_device_"
    //   strip _ → "my_cool_device"
    //   _ → -    → "my-cool-device"
    expect(friendlyNameSlugify("  My  Cool - Device  ")).toBe(
      "my-cool-device",
    );
  });

  it("drops characters outside [a-z0-9_-] before the underscore→hyphen pass", () => {
    expect(friendlyNameSlugify("kitchen.sensor")).toBe("kitchensensor");
    expect(friendlyNameSlugify("kitchen/sensor")).toBe("kitchensensor");
    expect(friendlyNameSlugify("kitchen (test)")).toBe("kitchen-test");
  });

  it("returns empty string for fully-stripped input", () => {
    expect(friendlyNameSlugify("...")).toBe("");
    expect(friendlyNameSlugify("")).toBe("");
    // All-diacritic input collapses to empty (the diacritic itself is
    // in the combining-mark range, but the base char is outside Latin).
    expect(friendlyNameSlugify("中文")).toBe("");
  });
});
