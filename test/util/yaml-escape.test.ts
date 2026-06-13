import { describe, expect, it } from "vitest";
import {
  escapeControlForInput,
  escapeForInput,
  escapeYamlDoubleQuoted,
  hasEscapeWorthyChar,
  isEscapeWorthy,
  unescapeControlForInput,
  unescapeForInput,
  unescapeYamlDoubleQuoted,
} from "../../src/util/yaml-escape.js";

// A Material Design Icon glyph (Plane-15 Private Use Area) — the value
// the font editor must round-trip as ``\U000F058F`` (device-builder#1232).
const MDI = String.fromCodePoint(0xf058f);

describe("isEscapeWorthy", () => {
  it("flags control and Private-Use code points", () => {
    expect(isEscapeWorthy(0x09)).toBe(true); // tab
    expect(isEscapeWorthy(0x7f)).toBe(true); // DEL
    expect(isEscapeWorthy(0xe000)).toBe(true); // BMP PUA
    expect(isEscapeWorthy(0xf058f)).toBe(true); // Plane-15 PUA-A
  });

  it("keeps ordinary printable text raw", () => {
    expect(isEscapeWorthy(0x41)).toBe(false); // A
    expect(isEscapeWorthy(0xe9)).toBe(false); // é
    expect(isEscapeWorthy(0x1f600)).toBe(false); // 😀 emoji
  });
});

describe("hasEscapeWorthyChar", () => {
  it("is true for a PUA glyph, false for a plain identifier", () => {
    expect(hasEscapeWorthyChar(MDI)).toBe(true);
    expect(hasEscapeWorthyChar("GPIO4")).toBe(false);
  });
});

describe("escapeYamlDoubleQuoted / unescapeYamlDoubleQuoted", () => {
  it("escapes a PUA glyph as \\U with uppercase hex", () => {
    expect(escapeYamlDoubleQuoted(MDI)).toBe("\\U000F058F");
  });

  it("escapes backslash and double quote", () => {
    expect(escapeYamlDoubleQuoted('a\\b"c')).toBe('a\\\\b\\"c');
  });

  it("decodes \\U / \\u / \\x and the short forms", () => {
    expect(unescapeYamlDoubleQuoted("\\U000F058F")).toBe(MDI);
    expect(unescapeYamlDoubleQuoted("\\u0041")).toBe("A");
    expect(unescapeYamlDoubleQuoted("\\x41")).toBe("A");
    expect(unescapeYamlDoubleQuoted("a\\nb")).toBe("a\nb");
    expect(unescapeYamlDoubleQuoted("a\\\\b")).toBe("a\\b");
  });

  it("keeps a malformed or lone-surrogate escape literal", () => {
    // \uD800 alone would yield ill-formed UTF-16; an incomplete \U is
    // not an escape. Both keep the backslash rather than dropping it.
    expect(unescapeYamlDoubleQuoted("\\Uzzzz")).toBe("\\Uzzzz");
    expect(unescapeYamlDoubleQuoted("\\uD800")).toBe("\\uD800");
  });

  it("preserves a raw-typed backslash that is not a recognized escape", () => {
    // A user typing ``C:\Users`` in any multi_value field keeps the
    // backslash; only valid escapes (``\U…``) are decoded.
    expect(unescapeYamlDoubleQuoted("C:\\Users")).toBe("C:\\Users");
  });

  it("is invertible, including for stored literal backslash-escape text", () => {
    // Doubling the backslash on escape is what stops a no-op edit of a
    // value like ``C:\x41bc`` from re-decoding ``\x41`` to ``A``.
    for (const s of ["C:\\x41bc", "a\\U0001F600b", "\\u0041", "plain", MDI]) {
      expect(unescapeYamlDoubleQuoted(escapeYamlDoubleQuoted(s))).toBe(s);
    }
  });
});

describe("escapeForInput / unescapeForInput (form input)", () => {
  it("shows a glyph as an editable escape and decodes it back", () => {
    expect(escapeForInput(MDI)).toBe("\\U000F058F");
    expect(unescapeForInput("\\U000F058F")).toBe(MDI);
  });

  it("leaves a literal path / regex untouched — only numeric escapes decode", () => {
    // The narrowing the renderer relies on: a value typed into any
    // multi_value field keeps ``\t`` as two chars (not a tab), so paths
    // and regexes are not silently rewritten.
    expect(unescapeForInput("C:\\temp")).toBe("C:\\temp");
    expect(unescapeForInput("\\d+")).toBe("\\d+");
  });

  it("does not escape quotes or short control forms on display", () => {
    expect(escapeForInput('a"b')).toBe('a"b');
  });

  it("is invertible — the renderer escapes on display and decodes on edit", () => {
    // The renderer applies escapeForInput unconditionally, so a no-op edit
    // of a value that merely looks like an escape (``C:\x41bc``) must round
    // back unchanged rather than decoding ``\x41`` to ``A`` (#647 review).
    for (const s of ["C:\\x41bc", "plain", MDI, "\\Users", "a\\b", "\\U0001"]) {
      expect(unescapeForInput(escapeForInput(s))).toBe(s);
    }
  });
});

describe("escapeControlForInput / unescapeControlForInput (text field)", () => {
  it("shows CR / LF / tab as readable short forms and decodes them back", () => {
    expect(escapeControlForInput("saveConfig\r\n")).toBe("saveConfig\\r\\n");
    expect(unescapeControlForInput("saveConfig\\r\\n")).toBe("saveConfig\r\n");
    expect(escapeControlForInput("a\tb")).toBe("a\\tb");
  });

  it("escapes other control bytes (ESC / NUL / DEL) numerically", () => {
    // A uart.write payload can carry arbitrary escapes; only \r \n \t get
    // the short form, everything else escape-worthy stays editable as \xNN.
    expect(escapeControlForInput("setRange\x1B")).toBe("setRange\\x1B");
    expect(escapeControlForInput("a\x00b")).toBe("a\\x00b");
    expect(escapeControlForInput("x\x7Fy")).toBe("x\\x7Fy");
  });

  it("leaves quotes raw and escapes a PUA glyph numerically", () => {
    expect(escapeControlForInput('a"b')).toBe('a"b');
    expect(escapeControlForInput(MDI)).toBe("\\U000F058F");
  });

  it("is invertible, so a no-op edit of escape-like text round-trips", () => {
    // ``C:\x41bc`` is a literally-typed backslash-x-41, not the byte 0x41;
    // doubling the backslash on display stops a no-op edit decoding it to A.
    for (const s of [
      "saveConfig\r\n",
      "AT\r\n\x1B[2J",
      "C:\\x41bc",
      "a\\nb",
      'q"q',
      MDI,
      "plain",
    ]) {
      expect(unescapeControlForInput(escapeControlForInput(s))).toBe(s);
    }
  });
});
