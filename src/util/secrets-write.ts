import type { ESPHomeAPI } from "../api/esphome-api.js";
import { secretValueFromYaml } from "./secret-eligibility.js";
import { splitInlineComment } from "./yaml-scalar.js";
import { formatYamlScalar } from "./yaml-serialize.js";

const SECRETS_FILE = "secrets.yaml";

/** Append ``key: value`` after the file's content, normalising trailing space. */
function appendSecret(content: string, key: string, value: string): string {
  const body = content.replace(/\s+$/, "");
  return `${body ? `${body}\n` : ""}${key}: ${formatYamlScalar(value)}\n`;
}

/** Replace the top-level ``key``'s value in *content* (preserving any inline
 *  comment), or append it when the key is absent. */
function replaceOrAppendSecret(content: string, key: string, value: string): string {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Top-level `key: value` only — skip indentation, blanks, and comments.
    if (!line || line[0] === " " || line[0] === "\t" || line[0] === "#") continue;
    const colon = line.search(/:(\s|$)/);
    if (colon < 0 || line.slice(0, colon).trim() !== key) continue;
    // `comment` keeps its leading whitespace ("" when none), so re-append it raw.
    const { comment } = splitInlineComment(line.slice(colon + 1));
    lines[i] = `${key}: ${formatYamlScalar(value)}${comment}`;
    return lines.join("\n");
  }
  return appendSecret(content, key, value);
}

/**
 * Ensure `key: value` exists in `secrets.yaml`, returning whether it was newly
 * created.
 *
 * Reads the file first and does NOT swallow a read failure: writing just the
 * new key after a transient read error would wipe every other secret, so a
 * failed read rejects (the caller aborts). If the key already exists its value
 * is left untouched and `{ created: false }` is returned — the existing value
 * may differ from *value*, and overwriting a shared/other-tab secret is worse
 * than reusing it. Otherwise the key is appended and a window `secrets-saved`
 * event is dispatched so every secret picker's cache refreshes.
 */
export async function ensureSecretInYaml(
  api: ESPHomeAPI,
  key: string,
  value: string
): Promise<{ created: boolean }> {
  const current = await api.getConfig(SECRETS_FILE); // throws → caller aborts
  if (secretValueFromYaml(current, key) !== null) {
    return { created: false };
  }
  await api.updateConfig(SECRETS_FILE, appendSecret(current, key, value));
  window.dispatchEvent(new CustomEvent("secrets-saved"));
  return { created: true };
}

/**
 * Overwrite ``key``'s value in secrets.yaml (or append it when absent),
 * preserving every other secret and any inline comment on the line. Unlike
 * `ensureSecretInYaml` this always writes — it backs the inline "edit this
 * secret" path. Dispatches ``secrets-saved`` so pickers refresh.
 */
export async function setSecretInYaml(
  api: ESPHomeAPI,
  key: string,
  value: string
): Promise<void> {
  const current = await api.getConfig(SECRETS_FILE);
  await api.updateConfig(SECRETS_FILE, replaceOrAppendSecret(current, key, value));
  window.dispatchEvent(new CustomEvent("secrets-saved"));
}
