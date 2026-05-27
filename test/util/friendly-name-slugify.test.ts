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
      "test-web-server-ota-esp32"
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
    // Pin the cleaner output our ``/_+/g`` collapse produces. This
    // is a deliberate divergence from upstream's single-pass
    // ``.replace("__", "_")`` (which would leave ``my-cool--device``
    // for the same input). See the implementation comment for the
    // why.
    expect(friendlyNameSlugify("  My  Cool - Device  ")).toBe("my-cool-device");
  });

  it("drops characters outside [a-z0-9_-] before the underscore→hyphen pass", () => {
    expect(friendlyNameSlugify("kitchen.sensor")).toBe("kitchensensor");
    expect(friendlyNameSlugify("kitchen/sensor")).toBe("kitchensensor");
    expect(friendlyNameSlugify("kitchen (test)")).toBe("kitchen-test");
  });

  it("returns empty string for fully-stripped input", () => {
    expect(friendlyNameSlugify("...")).toBe("");
    expect(friendlyNameSlugify("")).toBe("");
    // Non-Latin input collapses to empty: ``中文`` has no combining
    // marks, but the base codepoints are outside ``[a-z0-9_-]`` so
    // the post-NFD filter strips them. Same outcome upstream
    // ``friendly_name_slugify`` produces.
    expect(friendlyNameSlugify("中文")).toBe("");
  });
});
