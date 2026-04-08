/**
 * ESPHome YAML language support with embedded C++ highlighting for lambdas.
 *
 * Wraps the standard YAML parser with parseMixed to detect `!lambda` tagged
 * values and parse them as C++ using an overlay. Handles:
 *
 * - Inline:  `value: !lambda return x;`
 * - Quoted:  `value: !lambda 'return x;'`
 * - Block:   `value: !lambda |-\n  return x;`
 */
import { parser as yamlParser } from "@lezer/yaml";
import { cppLanguage } from "@codemirror/lang-cpp";
import { LRLanguage, LanguageSupport } from "@codemirror/language";
import { parseMixed } from "@lezer/common";
import type { SyntaxNodeRef, Input } from "@lezer/common";

const LAMBDA_TAG = "!lambda";

/**
 * Mixed parser wrapper: when we encounter a Tagged node whose Tag is
 * `!lambda`, overlay the C++ parser on the value content.
 */
function nestLambdas(node: SyntaxNodeRef, input: Input) {
  // Only interested in Tagged nodes (e.g. `!lambda <value>`)
  if (node.name !== "Tagged") return null;

  // Verify the Tag child is `!lambda`
  const tagNode = node.node.getChild("Tag");
  if (!tagNode) return null;
  const tagText = input.read(tagNode.from, tagNode.to);
  if (tagText !== LAMBDA_TAG) return null;

  // Find the value node — could be Literal, QuotedLiteral, or BlockLiteral
  const literal = node.node.getChild("Literal");
  const quoted = node.node.getChild("QuotedLiteral");
  const block = node.node.getChild("BlockLiteral");

  if (literal) {
    // Inline: `!lambda return x;` → overlay the Literal
    return {
      parser: cppLanguage.parser,
      overlay: [{ from: literal.from, to: literal.to }],
    };
  }

  if (quoted) {
    // Quoted: `!lambda 'return x;'` → overlay content inside quotes
    return {
      parser: cppLanguage.parser,
      overlay: [{ from: quoted.from + 1, to: quoted.to - 1 }],
    };
  }

  if (block) {
    // Block: `!lambda |-\n  code` → overlay the BlockLiteralContent
    const content = block.getChild("BlockLiteralContent");
    if (content) {
      return {
        parser: cppLanguage.parser,
        overlay: [{ from: content.from, to: content.to }],
      };
    }
  }

  return null;
}

/**
 * ESPHome YAML language with embedded C++ lambda support.
 */
export const esphomeYamlLanguage = LRLanguage.define({
  name: "esphome-yaml",
  parser: yamlParser.configure({
    wrap: parseMixed(nestLambdas),
  }),
  languageData: {
    commentTokens: { line: "#" },
    indentOnInput: /^\s*[\]}]$/,
  },
});

/**
 * Language support bundle for ESPHome YAML.
 */
export function esphomeYaml(): LanguageSupport {
  return new LanguageSupport(esphomeYamlLanguage);
}
