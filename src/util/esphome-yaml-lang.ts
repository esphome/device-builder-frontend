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
import { cppLanguage } from "@codemirror/lang-cpp";
import {
  LRLanguage,
  LanguageSupport,
  foldInside,
  foldNodeProp,
  indentService,
} from "@codemirror/language";
import type { Input, SyntaxNodeRef } from "@lezer/common";
import { parseMixed } from "@lezer/common";
import { parser as yamlParser } from "@lezer/yaml";
import { indentOf, stripComment } from "./yaml-line-walker.js";

const LAMBDA_TAG = "!lambda";

/** Line is a YAML list item: optional indent then ``- ``. */
const RE_LIST_ITEM = /^ *-\s/;
/** Trailing-colon block opener (``key:``). */
const RE_BLOCK_OPENER = /:\s*$/;
/** Block-scalar header (``key: |-`` / ``key: >+`` / ``lambda: |``). */
const RE_BLOCK_SCALAR_OPENER = /:\s*[|>][+-]?\s*$/;

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
    // Restore the fold ranges the bare @lezer/yaml parser doesn't carry
    // but @codemirror/lang-yaml's yamlLanguage adds — without these the
    // editor's fold gutter has nothing to fold. Block mappings/sequences
    // fold from the end of their opening line; flow collections fold
    // inside their delimiters.
    props: [
      foldNodeProp.add({
        "FlowMapping FlowSequence": foldInside,
        "Item Pair BlockLiteral": (node, state) => ({
          from: state.doc.lineAt(node.from).to,
          to: node.to,
        }),
      }),
    ],
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
 * line that ends with ``:`` opens a child block (indent + step), and
 * continuation lines inside a ``- item`` list are aligned to the
 * dash's content column (``dash + step``) so siblings of the first
 * key in a list item land at the right depth automatically (#134).
 *
 * Honors the simulated line break ``insertNewlineAndIndent`` sets at
 * ``pos`` (via ``context.lineAt(pos, -1)``), so the reference line is the
 * one the user is splitting — not the raw ``doc.lineAt(pos)``, which was
 * one line too high and gave the wrong indent on Enter (#744). Walks back
 * over blank lines so a stray blank between sections doesn't reset to 0.
 */
const yamlIndentService = indentService.of((context, pos) => {
  // ``context.unit`` is the editor's configured indent width (the
  // ``indentUnit`` facet, in columns), so the step tracks any future
  // change to the indent config instead of hard-coding ``+ 2``. A dash
  // continuation uses the same unit: YAML's ``- key`` is exactly one step
  // deeper than the dash's column.
  const step = context.unit;
  // ``lineAt(pos, -1)`` is the content up to the (simulated) break — the
  // line being split. Anchoring the walk-back here (inclusive) is the
  // #744 fix.
  const breakLine = context.lineAt(pos, -1);
  const startNumber = context.state.doc.lineAt(breakLine.from).number;
  for (let n = startNumber; n >= 1; n--) {
    // Start line: break-aware text (before the break). Earlier lines:
    // their full text.
    const text = n === startNumber ? breakLine.text : context.state.doc.line(n).text;
    if (!text.trim()) continue;
    // A ``  - <something>`` line: the natural continuation column is one
    // step past the dash's column (e.g. a sibling under
    // ``  - platform: gpio`` lands at 4, not 2).
    const baseIndent = RE_LIST_ITEM.test(text) ? indentOf(text) + step : indentOf(text);
    // Strip a trailing ``# comment`` so ``key:  # note`` still triggers
    // the block-opener rule (ESPHome configs sprinkle inline comments).
    const noComment = stripComment(text);
    // Two block-opener shapes, both opening a child one step deeper:
    //   1. ``key:`` — plain mapping.
    //   2. ``key: |-`` / ``key: >+`` / ``lambda: |`` — YAML block-scalar
    //      header whose next line is the scalar content (ESPHome's
    //      ``lambda: |-`` / ``!lambda |-`` shape).
    if (RE_BLOCK_OPENER.test(noComment) || RE_BLOCK_SCALAR_OPENER.test(noComment)) {
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
