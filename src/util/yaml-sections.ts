export interface YamlSection {
  key: string;
  fromLine: number; // 1-indexed (CodeMirror convention)
  toLine: number; // 1-indexed, inclusive
  name?: string; // "name:" value from a YAML list item
  platform?: string; // "platform:" value from a YAML list item
  parentKey?: string; // top-level key when this is an expanded list item
}

export interface CategorizedSections {
  core: YamlSection[];
  components: YamlSection[];
  automations: YamlSection[];
}

// ESPHome system/platform keys → Core configuration
const CORE_KEYS = new Set([
  "esphome", "esp32", "esp8266", "rp2040", "bk72xx", "rtl87xx",
  "logger", "api", "ota", "wifi", "ethernet", "mqtt", "mdns",
  "network", "web_server", "captive_portal", "improv_serial",
  "safe_mode", "debug", "preferences", "external_components",
  "packages", "substitutions", "dashboard_import", "time",
]);

// Automation/logic keys → Automations
// In ESPHome, automations are inline on_* handlers within components.
// script, globals and interval are the standalone automation-adjacent top-level keys.
const AUTOMATION_KEYS = new Set([
  "script", "globals", "interval",
]);

export function categorizeSections(sections: YamlSection[]): CategorizedSections {
  const core: YamlSection[] = [];
  const components: YamlSection[] = [];
  const automations: YamlSection[] = [];

  for (const section of sections) {
    if (CORE_KEYS.has(section.key)) {
      core.push(section);
    } else if (AUTOMATION_KEYS.has(section.key)) {
      automations.push(section);
    } else {
      components.push(section);
    }
  }

  return { core, components, automations };
}

/**
 * Extracts top-level YAML keys and their line ranges.
 * Top-level keys have no leading whitespace (e.g. `esphome:`, `wifi:`).
 * Sections containing YAML list items (e.g. `light:\n  - platform: binary`)
 * are expanded so each list item becomes its own section with name/platform metadata.
 */
export function parseYamlTopLevelSections(yaml: string): YamlSection[] {
  const lines = yaml.split("\n");
  const rawSections: Array<{ key: string; fromLine: number; toLine: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^([a-zA-Z_][a-zA-Z0-9_]*):/);
    if (match) {
      if (rawSections.length > 0) {
        rawSections[rawSections.length - 1].toLine = i;
      }
      rawSections.push({
        key: match[1],
        fromLine: i + 1, // convert 0-indexed array to 1-indexed CM line
        toLine: lines.length,
      });
    }
  }

  // Trim the trailing empty line (yaml strings often end with \n)
  if (rawSections.length > 0 && lines[lines.length - 1] === "") {
    rawSections[rawSections.length - 1].toLine = lines.length - 1;
  }

  // Expand list items within each section
  const sections: YamlSection[] = [];
  for (const raw of rawSections) {
    sections.push(..._expandListItems(lines, raw));
  }

  return sections;
}

/**
 * If a top-level section contains YAML list items (`  - `), expand each into
 * its own YamlSection with name, platform, and parentKey metadata.
 * Otherwise return the section as-is.
 */
function _expandListItems(
  lines: string[],
  section: { key: string; fromLine: number; toLine: number },
): YamlSection[] {
  const keyIdx = section.fromLine - 1; // 0-indexed line of the top-level key
  const endIdx = section.toLine - 1; // 0-indexed last line (inclusive)

  // Find list item starts (`  - ` or `  -\n`)
  const listStarts: number[] = [];
  for (let i = keyIdx + 1; i <= endIdx; i++) {
    if (/^  -\s/.test(lines[i]) || /^  -$/.test(lines[i])) {
      listStarts.push(i);
    }
  }

  if (listStarts.length === 0) {
    return [{ key: section.key, fromLine: section.fromLine, toLine: section.toLine }];
  }

  const items: YamlSection[] = [];
  for (let idx = 0; idx < listStarts.length; idx++) {
    const itemStart = listStarts[idx];
    const itemEnd =
      idx + 1 < listStarts.length ? listStarts[idx + 1] - 1 : endIdx;

    let name = "";
    let platform = "";
    for (let j = itemStart; j <= itemEnd; j++) {
      const nameMatch = lines[j].match(/^\s+(?:-\s+)?name:\s*["']?(.+?)["']?\s*$/);
      if (nameMatch) name = nameMatch[1];
      const platformMatch = lines[j].match(
        /^\s+(?:-\s+)?platform:\s*["']?(\S+?)["']?\s*$/,
      );
      if (platformMatch) platform = platformMatch[1];
    }

    items.push({
      key: section.key,
      fromLine: itemStart + 1, // 1-indexed
      toLine: itemEnd + 1, // 1-indexed
      name: name || undefined,
      platform: platform || undefined,
      parentKey: section.key,
    });
  }

  return items;
}

/**
 * Finds inline ESPHome automation handlers (on_press:, on_value_range:, etc.)
 * nested inside component definitions and returns them as navigable sections.
 * The key is formatted as "<component name> → <event>" when a name is available.
 */
export function parseYamlAutomations(yaml: string): YamlSection[] {
  const lines = yaml.split("\n");
  const automations: YamlSection[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\s+)(on_[a-zA-Z_]+):/);
    if (!match) continue;

    const indent = match[1].length;
    const eventName = match[2];
    const fromLine = i + 1; // 1-indexed CM line

    // End of block = first non-empty line at same or lower indentation
    let toLine = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === "") continue;
      const lineIndent = (lines[j].match(/^(\s*)/) ?? ["", ""])[1].length;
      if (lineIndent <= indent) {
        toLine = j; // array index j = CM line j (last line of this block is j-1+1 = j)
        break;
      }
    }

    // Look backwards for the nearest `name:` within the same component item
    let parentName = "";
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j].match(/^[a-zA-Z]/)) break; // hit a top-level key
      const nameMatch = lines[j].match(/^\s+name:\s*["']?(.+?)["']?\s*$/);
      if (nameMatch) {
        parentName = nameMatch[1];
        break;
      }
    }

    automations.push({
      key: parentName ? `${parentName} → ${eventName}` : eventName,
      fromLine,
      toLine,
    });
  }

  return automations;
}
