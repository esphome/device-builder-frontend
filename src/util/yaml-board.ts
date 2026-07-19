import type { SlimBoard } from "../api/types/boards.js";
import { chipNameToVariant } from "./chip-variant.js";
import { canonicalComponentKey, TARGET_PLATFORM_KEYS } from "./component-presence.js";
import {
  lineIndent,
  parseYamlTopLevelSections,
  readInstanceScalar,
} from "./yaml-sections-core.js";

export interface YamlPlatformBoard {
  /** Canonical platform key (`rp2` folded to `rp2040`). */
  platform: string;
  board: string | null;
  variant: string | null;
}

/**
 * The target platform's `board:` / `variant:` scalars from a YAML document.
 *
 * Only direct children of the platform section are read (gated on the
 * first child's indent), so a nested `framework:` block can't shadow.
 * `null` when no platform section exists (packages-based configs).
 */
export function readPlatformBoard(yaml: string): YamlPlatformBoard | null {
  const section = parseYamlTopLevelSections(yaml).find((s) =>
    TARGET_PLATFORM_KEYS.has(s.key)
  );
  if (!section) return null;
  const lines = yaml.split("\n");
  let board: string | null = null;
  let variant: string | null = null;
  let childIndent: number | null = null;
  // fromLine is the section's own `<key>:` line (1-indexed); children follow.
  for (let i = section.fromLine; i < section.toLine && i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = lineIndent(line);
    childIndent ??= indent;
    if (indent !== childIndent) continue;
    board ??= readInstanceScalar(line, "board");
    variant ??= readInstanceScalar(line, "variant");
  }
  return { platform: canonicalComponentKey(section.key), board, variant };
}

/**
 * Whether the YAML names a different chip than the selected catalog board.
 *
 * Curated-vs-generic picks sharing one PlatformIO board string compare
 * equal on every axis and never flag.
 */
export function boardDisagreesWithYaml(
  parsed: YamlPlatformBoard,
  board: SlimBoard
): boolean {
  if (parsed.platform !== canonicalComponentKey(board.esphome.platform)) return true;
  if (parsed.board && parsed.board.toLowerCase() !== board.esphome.board.toLowerCase()) {
    return true;
  }
  return Boolean(
    parsed.variant &&
    board.esphome.variant &&
    chipNameToVariant(parsed.variant) !== chipNameToVariant(board.esphome.variant)
  );
}
