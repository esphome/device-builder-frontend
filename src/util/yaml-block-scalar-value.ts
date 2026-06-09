/**
 * Turn a parsed block-scalar header plus its captured body lines into a
 * section-editor form value. Split out of yaml-section-reader.ts to keep
 * that file under the size cap.
 */

import type { LambdaValue } from "../api/types/automations.js";
import type { BlockScalarHeader } from "./yaml-section-lexer.js";
import { YamlRawValue } from "./yaml-serialize.js";

// Only the canonical strip-chomped literal block becomes an editable
// lambda; folded (>) or keep (|+) markers carry semantics the editor
// would normalise away, so they stay opaque YamlRawValue blocks.
export const isEditableLambdaBlock = (header: BlockScalarHeader): boolean =>
  header.tag === "!lambda" && header.marker === "|-";

// Dedents via YamlRawValue.body and drops only trailing newlines (the
// |- strip chomp), so trailing spaces on the last line survive.
export const lambdaValueFromBlock = (bodyLines: string[]): LambdaValue => ({
  _lambda: new YamlRawValue(bodyLines).body.replace(/\n+$/, ""),
  _tag: "!lambda",
});

// Editable LambdaValue for a canonical !lambda |-, else a YamlRawValue
// carrying the verbatim header so any other tag/marker round-trips.
export const blockScalarValue = (
  header: BlockScalarHeader,
  rawHeader: string,
  bodyLines: string[]
): LambdaValue | YamlRawValue =>
  isEditableLambdaBlock(header)
    ? lambdaValueFromBlock(bodyLines)
    : new YamlRawValue(bodyLines, rawHeader);
