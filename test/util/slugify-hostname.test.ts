/**
 * Pins slugifyHostname against the backend slugify_hostname it mirrors:
 * esphome friendly_name_slugify plus the 31-char hostname clamp.
 */
import { describe, expect, it } from "vitest";

import { slugifyHostname } from "../../src/util/slugify-hostname.js";

describe("slugifyHostname", () => {
  it("lowercases and dashes a display name", () => {
    expect(slugifyHostname("Dining Room AC")).toBe("dining-room-ac");
  });

  it("strips accents", () => {
    expect(slugifyHostname("Café Señor")).toBe("cafe-senor");
  });

  it("turns underscores into dashes", () => {
    expect(slugifyHostname("hello_world")).toBe("hello-world");
  });

  it("trims surrounding whitespace", () => {
    expect(slugifyHostname("  Kitchen  ")).toBe("kitchen");
  });

  it("drops disallowed characters", () => {
    expect(slugifyHostname("AC (2nd floor)")).toBe("ac-2nd-floor");
  });

  it("returns empty for punctuation-only input", () => {
    expect(slugifyHostname("!!!")).toBe("");
  });

  it("clamps to 31 chars and drops a dash left dangling at the cut", () => {
    const slug = slugifyHostname("x".repeat(30) + " tail");
    expect(slug).toBe("x".repeat(30));
    expect(slugifyHostname("x".repeat(40)).length).toBe(31);
  });
});
