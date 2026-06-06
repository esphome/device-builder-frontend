import type { ESPHomeAPI } from "../api/esphome-api.js";
import { secretValueFromYaml } from "./secret-eligibility.js";
import { formatYamlScalar } from "./yaml-serialize.js";

const SECRETS_FILE = "secrets.yaml";

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
  const body = current.replace(/\s+$/, "");
  const updated = `${body ? `${body}\n` : ""}${key}: ${formatYamlScalar(value)}\n`;
  await api.updateConfig(SECRETS_FILE, updated);
  window.dispatchEvent(new CustomEvent("secrets-saved"));
  return { created: true };
}
