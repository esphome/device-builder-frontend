import { describe, expect, it } from "vitest";
import { splitYamlDocLines, yamlDocEol } from "../../src/util/yaml-doc-lines.js";

describe("splitYamlDocLines", () => {
  it("strips the CR from every CRLF line", () => {
    expect(splitYamlDocLines("a\r\nb\r\n")).toEqual(["a", "b", ""]);
  });

  it("strips a bare CR on an unterminated final line", () => {
    expect(splitYamlDocLines("a\r\nb\r")).toEqual(["a", "b"]);
  });

  it("handles degenerate inputs", () => {
    expect(splitYamlDocLines("")).toEqual([""]);
    expect(splitYamlDocLines("a\r\nb")).toEqual(["a", "b"]);
    expect(splitYamlDocLines("a\nb")).toEqual(["a", "b"]);
  });
});

describe("yamlDocEol", () => {
  it("picks the majority ending", () => {
    expect(yamlDocEol("a\r\nb\r\nc\n")).toBe("\r\n");
    expect(yamlDocEol("a\nb\nc\r\n")).toBe("\n");
  });

  it("ties go to LF", () => {
    expect(yamlDocEol("a: 1\r\nb: 2\n")).toBe("\n");
  });

  it("defaults to LF with no newline at all", () => {
    expect(yamlDocEol("")).toBe("\n");
    expect(yamlDocEol("a: 1")).toBe("\n");
  });
});
