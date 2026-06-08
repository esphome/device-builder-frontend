import type { ESPHomeAPI } from "../api/esphome-api.js";

/**
 * Ensure `key: value` exists in `secrets.yaml`, returning whether it was newly
 * created.
 *
 * Delegates to the atomic `config/set_secret` command with `overwrite=false`,
 * so the existence-check-and-write happens under the backend's lock rather than
 * as a racy read-then-write here: if the key already exists its value is left
 * untouched (`{ created: false }`) because clobbering a shared/other-tab secret
 * is worse than reusing it. On a create, a window `secrets-saved` event is
 * dispatched so every secret picker's cache refreshes.
 */
export async function ensureSecretInYaml(
  api: ESPHomeAPI,
  key: string,
  value: string
): Promise<{ created: boolean }> {
  const { created } = await api.setSecret(key, value, false);
  if (created) window.dispatchEvent(new CustomEvent("secrets-saved"));
  return { created };
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
  await api.setSecret(key, value, true);
  window.dispatchEvent(new CustomEvent("secrets-saved"));
}
