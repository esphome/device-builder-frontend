import { describe, expect, it } from "vitest";
import { buildWebUiUrl, safeWebUiUrl } from "../../src/util/web-ui-url.js";
import { makeConfiguredDevice as _device } from "../_make-configured-device.js";

describe("safeWebUiUrl", () => {
  it("accepts http URLs", () => {
    expect(safeWebUiUrl("http://kitchen.local")).toBe("http://kitchen.local");
    expect(safeWebUiUrl("http://kitchen.local:8080")).toBe("http://kitchen.local:8080");
  });

  it("accepts https URLs", () => {
    expect(safeWebUiUrl("https://kitchen.local")).toBe("https://kitchen.local");
  });

  it("rejects javascript: URLs", () => {
    expect(safeWebUiUrl("javascript:alert(1)")).toBe("");
  });

  it("rejects data: URLs", () => {
    expect(safeWebUiUrl("data:text/html,<script>alert(1)</script>")).toBe("");
  });

  it("rejects file: URLs", () => {
    expect(safeWebUiUrl("file:///etc/passwd")).toBe("");
  });

  it("rejects URLs carrying userinfo (host-spoofing via @)", () => {
    // ``http://device.local@evil.com`` parses as a valid http URL
    // whose host is ``evil.com`` — the leading segment is a username.
    // A hostile device announcement could use this to point the
    // "Visit Web UI" link at an attacker origin.
    expect(safeWebUiUrl("http://device.local@evil.com")).toBe("");
    expect(safeWebUiUrl("http://1.2.3.4@evil.com:6053")).toBe("");
    expect(safeWebUiUrl("https://user:pass@evil.com")).toBe("");
    // Empty-userinfo variants still parse with host=evil.com.
    expect(safeWebUiUrl("http://@evil.com")).toBe("");
    expect(safeWebUiUrl("http://:@evil.com")).toBe("");
    // Abbreviated authority forms the WHATWG parser still accepts:
    // fewer-than-two slashes (and backslashes) after the scheme all
    // parse with host=evil.com, so the slice can't key off ``://``.
    expect(safeWebUiUrl("http:/user@evil.com")).toBe("");
    expect(safeWebUiUrl("http:user@evil.com")).toBe("");
    expect(safeWebUiUrl("http:\\\\user@evil.com")).toBe("");
  });

  it("rejects userinfo smuggled past the guard with control chars in the scheme", () => {
    // The WHATWG URL parser silently strips ASCII tab/CR/LF from
    // anywhere in the input, so ``ht\ntp://device.local@evil.com``
    // parses as a valid http URL with host ``evil.com``. The control
    // char shifts the scheme's raw length out of sync with the parsed
    // ``protocol``, so a naive ``url.slice(protocol.length)`` reads the
    // authority from the wrong offset and never sees the ``@`` —
    // letting an attacker origin through the userinfo guard.
    expect(safeWebUiUrl("ht\ntp://device.local@evil.com")).toBe("");
    expect(safeWebUiUrl("ht\ttp://device.local@evil.com")).toBe("");
    expect(safeWebUiUrl("http\n://device.local@evil.com")).toBe("");
    expect(safeWebUiUrl("h\rttp://user@evil.com")).toBe("");
    // A control char inside the authority itself must also be caught.
    expect(safeWebUiUrl("http://device.local\t@evil.com")).toBe("");
    // ASCII form feed (U+000C) is NOT in the parser's interior
    // strip set (only tab/CR/LF are), so unlike those it can't desync
    // the slice: an interior form feed in the scheme is an invalid
    // scheme char that makes ``new URL`` throw, and one in the
    // authority stays in the slice so the ``@`` guard still fires.
    expect(safeWebUiUrl("ht\ftp://device.local@evil.com")).toBe("");
    expect(safeWebUiUrl("http://device.local\f@evil.com")).toBe("");
  });

  it("rejects userinfo smuggled past the guard with leading C0/space", () => {
    // The parser also trims leading/trailing C0 control chars and
    // spaces (U+0000–U+0020) before computing ``protocol``, so a
    // leading space desyncs the raw-string authority slice the same
    // way an interior control char does. Sanitizing those keeps the
    // slice aligned and the ``@`` guard intact.
    expect(safeWebUiUrl(" http://device.local@evil.com")).toBe("");
    expect(safeWebUiUrl("\x00http://device.local@evil.com")).toBe("");
    // Form feed (U+000C) is a C0 control, so a leading one is trimmed
    // by both the parser and ``cleaned`` and the slice stays aligned.
    expect(safeWebUiUrl("\fhttp://device.local@evil.com")).toBe("");
  });

  it("allows a legitimate @ in the path or query", () => {
    // The authority guard must not over-reject a ``@`` that appears
    // after the host (path/query/fragment), where it's just data.
    expect(safeWebUiUrl("http://kitchen.local/p?u=a@b")).toBe(
      "http://kitchen.local/p?u=a@b"
    );
  });

  it("rejects malformed URLs", () => {
    expect(safeWebUiUrl("not a url")).toBe("");
    expect(safeWebUiUrl("://kitchen.local")).toBe("");
  });

  it("rejects empty string", () => {
    expect(safeWebUiUrl("")).toBe("");
  });

  it("returns the input verbatim (no canonicalization)", () => {
    // ``new URL("http://host:22").toString()`` adds a trailing
    // slash; we return the raw input so callers see the terse form.
    expect(safeWebUiUrl("http://host:22")).toBe("http://host:22");
  });
});

describe("buildWebUiUrl", () => {
  it("returns empty string when web_port is null", () => {
    expect(buildWebUiUrl(_device({ web_port: null }))).toBe("");
  });

  it("returns empty string when neither address nor ip is set", () => {
    expect(buildWebUiUrl(_device({ web_port: 80, address: "", ip: "" }))).toBe("");
  });

  it("uses the mDNS address when present", () => {
    expect(buildWebUiUrl(_device({ web_port: 80, address: "kitchen.local" }))).toBe(
      "http://kitchen.local"
    );
  });

  it("falls back to ip when address is empty", () => {
    expect(buildWebUiUrl(_device({ web_port: 80, address: "", ip: "10.0.0.5" }))).toBe(
      "http://10.0.0.5"
    );
  });

  it("omits the port when it's the default 80", () => {
    expect(buildWebUiUrl(_device({ web_port: 80, address: "kitchen.local" }))).toBe(
      "http://kitchen.local"
    );
  });

  it("includes a non-default port", () => {
    expect(buildWebUiUrl(_device({ web_port: 8080, address: "kitchen.local" }))).toBe(
      "http://kitchen.local:8080"
    );
  });

  it("includes ports below 80 verbatim", () => {
    expect(buildWebUiUrl(_device({ web_port: 22, address: "host" }))).toBe(
      "http://host:22"
    );
  });

  it("brackets IPv6 hosts so the port suffix stays unambiguous", () => {
    expect(
      buildWebUiUrl(
        _device({ web_port: 80, address: "", ip: "fe80::de54:75ff:fec7:cc0" })
      )
    ).toBe("http://[fe80::de54:75ff:fec7:cc0]");
    expect(
      buildWebUiUrl(
        _device({
          web_port: 8080,
          address: "",
          ip: "2001:470:59ca:991:de54:75ff:fec7:cc0",
        })
      )
    ).toBe("http://[2001:470:59ca:991:de54:75ff:fec7:cc0]:8080");
  });

  it("returns empty string when the address smuggles a userinfo @", () => {
    // A hostile mDNS address like ``1.2.3.4@evil.com`` would otherwise
    // build ``http://1.2.3.4@evil.com`` — a link to evil.com.
    expect(buildWebUiUrl(_device({ web_port: 80, address: "1.2.3.4@evil.com" }))).toBe(
      ""
    );
    // Empty-userinfo smuggling: ``@evil.com`` builds ``http://@evil.com``.
    expect(buildWebUiUrl(_device({ web_port: 80, address: "@evil.com" }))).toBe("");
  });

  it("leaves IPv4 and hostnames unbracketed", () => {
    expect(buildWebUiUrl(_device({ web_port: 8080, address: "", ip: "10.0.0.5" }))).toBe(
      "http://10.0.0.5:8080"
    );
    expect(buildWebUiUrl(_device({ web_port: 8080, address: "kitchen.local" }))).toBe(
      "http://kitchen.local:8080"
    );
  });
});
