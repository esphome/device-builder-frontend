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
import { LRLanguage, LanguageSupport, indentService } from "@codemirror/language";
import { parseMixed } from "@lezer/common";
import type { SyntaxNodeRef, Input } from "@lezer/common";

const LAMBDA_TAG = "!lambda";

/**
 * Single source of truth for ESPHome YAML's indent width. Two
 * spaces matches the legacy dashboard and the upstream ESPHome
 * code style. Exported so consumers (the editor, tests) share
 * the same unit and the indent service derives ``step`` from it.
 */
export const ESPHOME_YAML_INDENT = "  ";

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
 * YAML auto-indent service. Mirrors the legacy esphome dashboard's
 * Monaco rule (``beforeText: /:\s*$/`` → ``IndentAction.Indent``)
 * plus list-item continuation handling: pressing Enter under a
 * line that ends with ``:`` opens a child block (indent + 2), and
 * continuation lines inside a ``- item`` list are aligned to the
 * dash's content column (``dash + 2``) so siblings of the first
 * key in a list item land at the right depth automatically.
 *
 * Without this the new editor required the user to manually
 * Tab/space every nested line — a real regression from the
 * legacy editor (issue #134).
 *
 * Walks back over blank lines to find the nearest non-blank
 * predecessor so a stray blank between sections doesn't reset
 * indent to 0.
 */
const yamlIndentService = indentService.of((context, pos) => {
  // ``context.unit`` is the editor's configured indent width (the
  // ``indentUnit`` facet, in columns). Deriving the step from it
  // means the service tracks any future change to the editor's
  // indent configuration instead of hard-coding ``+ 2``. The dash
  // continuation also uses ``unit`` because YAML's ``- key`` is
  // exactly one indent step deeper than the dash's column.
  const step = context.unit;
  const currentLineNumber = context.state.doc.lineAt(pos).number;
  for (let n = currentLineNumber - 1; n >= 1; n--) {
    const text = context.state.doc.line(n).text;
    if (!text.trim()) continue;
    // A line of the form ``  - <something>``: the natural
    // continuation column is one indent step past the dash's column,
    // not the dash's leading whitespace. Without this, a
    // continuation under ``  - platform: gpio`` would land at
    // column 2 instead of 4.
    const dashMatch = text.match(/^( *)-\s/);
    const baseIndent = dashMatch
      ? dashMatch[1].length + step
      : (text.match(/^( *)/)?.[1].length ?? 0);
    // Trailing-colon line opens a child block. Strip a trailing
    // ``# comment`` first so ``key:  # note`` still triggers
    // (ESPHome configs sprinkle inline comments freely).
    const noComment = text.replace(/\s+#.*$/, "");
    // Two block-opener shapes:
    //   1. ``key:`` — plain mapping → child indent + step
    //   2. ``key: |-`` / ``key: >+`` / ``lambda: |`` etc. — YAML
    //      block-scalar header. The next line is the scalar's
    //      content, which lives one step deeper than the key.
    //      Crucial for ESPHome's ``lambda: |-`` and ``!lambda |-``
    //      patterns, which would otherwise force the user to
    //      hand-indent every line of C++.
    if (/:\s*$/.test(noComment) || /:\s*[|>][+-]?\s*$/.test(noComment)) {
      return baseIndent + step;
    }
    return baseIndent;
  }
  return null;
});

/**
 * Language support bundle for ESPHome YAML.
 */
export function esphomeYaml(): LanguageSupport {
  return new LanguageSupport(esphomeYamlLanguage, [yamlIndentService]);
}
