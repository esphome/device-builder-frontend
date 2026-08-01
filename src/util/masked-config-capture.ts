import type { ESPHomeAPI } from "../api/index.js";
import { loadConfigWithRecovery } from "./load-with-recovery.js";
import { maskSensitiveYaml } from "./yaml-sensitive-redact.js";

// The report is filable without config, so a dead link must not pin the
// caller on a spinner (the recovery read parks on ``api.ready`` while
// the socket is down).
const CONFIG_READ_TIMEOUT_MS = 30_000;

const READ_ATTEMPTS = 4;

/**
 * Read a device's YAML and mask its credentials for an outbound report.
 *
 * Resolves to the masked YAML, "" when the read failed, or null once
 * *abandoned* went true.
 */
export async function captureMaskedConfig(
  api: ESPHomeAPI,
  configuration: string,
  abandoned: () => boolean
): Promise<string | null> {
  try {
    const yaml = await loadConfigWithRecovery(api, configuration, {
      abandoned,
      attempts: READ_ATTEMPTS,
      deadlineMs: CONFIG_READ_TIMEOUT_MS,
    });
    if (yaml === null) return null;
    return maskSensitiveYaml(yaml);
  } catch (err) {
    console.warn("Reading the config failed", err);
    return abandoned() ? null : "";
  }
}
