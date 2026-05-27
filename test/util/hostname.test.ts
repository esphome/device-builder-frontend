import { describe, expect, it } from "vitest";
import {
  friendlyHostname,
  normalizeHostnameForCompare,
  parsePortInput,
  trimTrailingDot,
} from "../../src/util/hostname.js";

describe("trimTrailingDot", () => {
  it("strips a single trailing dot", () => {
    expect(trimTrailingDot("mydashboard.local.")).toBe("mydashboard.local");
  });

  it("returns the input unchanged when no trailing dot", () => {
    expect(trimTrailingDot("mydashboard.local")).toBe("mydashboard.local");
  });

  it("preserves case so users see what they registered", () => {
    expect(trimTrailingDot("MyDashboard.local.")).toBe("MyDashboard.local");
  });

  it("handles IP literals and plain short names", () => {
    expect(trimTrailingDot("192.168.1.10")).toBe("192.168.1.10");
    expect(trimTrailingDot("mac")).toBe("mac");
  });

  it("strips only one trailing dot", () => {
    // Defensive: shouldn't ever happen with real mDNS output,
    // but the function shouldn't aggressively strip multiple
    // either; the user might genuinely type one.
    expect(trimTrailingDot("mydashboard.local..")).toBe("mydashboard.local.");
  });
});

describe("normalizeHostnameForCompare", () => {
  it("lowercases per RFC 4343", () => {
    expect(normalizeHostnameForCompare("MyDashboard.LOCAL")).toBe("mydashboard.local");
  });

  it("strips trailing dot", () => {
    expect(normalizeHostnameForCompare("mydashboard.local.")).toBe("mydashboard.local");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeHostnameForCompare("  mydashboard.local  ")).toBe(
      "mydashboard.local"
    );
  });

  it("matches the dedupe scenario from the field report", () => {
    // Persisted pairing: "mydashboard.local"
    // Freshly-discovered mDNS row: "MyDashboard.local."
    // The "already paired" check must consider these equal.
    expect(normalizeHostnameForCompare("mydashboard.local")).toBe(
      normalizeHostnameForCompare("MyDashboard.local.")
    );
  });

  it("is idempotent on already-normalised input", () => {
    const norm = normalizeHostnameForCompare("MyDashboard.local.");
    expect(normalizeHostnameForCompare(norm)).toBe(norm);
  });
});

describe("friendlyHostname", () => {
  it("strips trailing dot and the .local suffix", () => {
    expect(friendlyHostname("MyDashboard.local.")).toBe("MyDashboard");
  });

  it("strips just the .local suffix when no trailing dot", () => {
    expect(friendlyHostname("MyDashboard.local")).toBe("MyDashboard");
  });

  it("preserves case so users see what they registered", () => {
    expect(friendlyHostname("MyDashboard.local.")).toBe("MyDashboard");
  });

  it("matches .local case-insensitively", () => {
    expect(friendlyHostname("MyDashboard.LOCAL")).toBe("MyDashboard");
  });

  it("returns the input shape for IP literals", () => {
    expect(friendlyHostname("192.168.1.10")).toBe("192.168.1.10");
  });

  it("returns the input shape for non-mDNS FQDNs", () => {
    expect(friendlyHostname("buildhost.example.com")).toBe("buildhost.example.com");
  });

  it("returns the input shape for plain short names", () => {
    expect(friendlyHostname("buildhost")).toBe("buildhost");
  });

  it("trims surrounding whitespace", () => {
    expect(friendlyHostname("  MyDashboard.local.  ")).toBe("MyDashboard");
  });
});

describe("parsePortInput", () => {
  it("returns the integer for a valid in-range port", () => {
    expect(parsePortInput("6055")).toBe(6055);
    expect(parsePortInput("1")).toBe(1);
    expect(parsePortInput("65535")).toBe(65535);
  });

  it("trims surrounding whitespace", () => {
    expect(parsePortInput("  6055  ")).toBe(6055);
  });

  it("rejects empty / whitespace-only", () => {
    expect(parsePortInput("")).toBeNull();
    expect(parsePortInput("   ")).toBeNull();
  });

  it("rejects out-of-range values", () => {
    expect(parsePortInput("0")).toBeNull();
    expect(parsePortInput("65536")).toBeNull();
    expect(parsePortInput("99999999")).toBeNull();
  });

  it("rejects non-decimal content", () => {
    // ``Number.parseInt`` would accept these and return a
    // value; the regex pre-check rejects them so partial
    // edits / accidental garbage don't slip through.
    expect(parsePortInput("6055abc")).toBeNull();
    expect(parsePortInput("abc6055")).toBeNull();
    expect(parsePortInput("60.55")).toBeNull();
    expect(parsePortInput("0x6055")).toBeNull();
    expect(parsePortInput("-6055")).toBeNull();
    expect(parsePortInput("+6055")).toBeNull();
  });
});
