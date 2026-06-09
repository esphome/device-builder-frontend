/**
 * Turn a parsed block-scalar header (`parseBlockScalarHeader`) plus its
 * captured body lines into a section-editor form value. Kept out of
 * yaml-section-reader.ts (already over the file-size cap) so the reader
 * doesn't keep growing.
 */

import type { LambdaValue } from "../api/types/automations.js";
import { YamlRawValue } from "./yaml-serialize.js";

/**
 * True for the canonical strip-chomped literal block (`|-`) — the only
 * marker the form's lambda editor (and the serializer) emit. Other
 * markers (folded `>`, keep `|+`) carry distinct YAML semantics the
 * editor would silently normalise to `|-`, so they stay opaque
 * YamlRawValue blocks instead of editable lambdas.
 */
export const isEditableLambdaBlock = (header: {
  tag: string | undefined;
  marker: string;
}): boolean => header.tag === "!lambda" && header.marker === "|-";

/**
 * Build a LambdaValue sentinel from a captured `!lambda |-` block body.
 * Reuses YamlRawValue.body to strip the block's common indent (so
 * '          return 0.01;' becomes 'return 0.01;'); only trailing
 * newlines are dropped (the `|-` strip chomp), not trailing spaces or
 * tabs on the last line.
 */
export const lambdaValueFromBlock = (bodyLines: string[]): LambdaValue => ({
  _lambda: new YamlRawValue(bodyLines).body.replace(/\n+$/, ""),
  _tag: "!lambda",
});

/**
 * Turn a (possibly tagged) block-scalar header + its captured body
 * lines into a form value: a LambdaValue for a canonical `!lambda |-`
 * so the value stays editable, a YamlRawValue (carrying the verbatim
 * header) for any other tag, marker, or a bare `|-` / `>` block.
 */
export const blockScalarValue = (
  header: { tag: string | undefined; marker: string },
  rawHeader: string,
  bodyLines: string[]
): LambdaValue | YamlRawValue =>
  isEditableLambdaBlock(header)
    ? lambdaValueFromBlock(bodyLines)
    : new YamlRawValue(bodyLines, rawHeader);
