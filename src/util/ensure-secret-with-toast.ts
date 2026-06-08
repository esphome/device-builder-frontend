import toast from "sonner-js";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { LocalizeFunc } from "../common/localize.js";
import { ensureSecretInYaml } from "./secrets-write.js";

/**
 * Write ``key: value`` to secrets.yaml (idempotent, never clobbers) and toast
 * the outcome: ``createdKey`` on a fresh write, the shared "linked" message
 * when the key already existed (cache stale / another tab — its value may
 * differ), ``errorKey`` on failure. Returns true when the secret is in place,
 * false on a failed write so callers skip their follow-up.
 */
export async function ensureSecretWithToast(
  api: ESPHomeAPI,
  key: string,
  value: string,
  localize: LocalizeFunc,
  messages: { createdKey: string; errorKey: string; logLabel: string }
): Promise<boolean> {
  try {
    const { created } = await ensureSecretInYaml(api, key, value);
    toast[created ? "success" : "info"](
      localize(created ? messages.createdKey : "device.secret_picker_linked", { key }),
      { richColors: true }
    );
    return true;
  } catch (err) {
    console.error(messages.logLabel, err);
    toast.error(localize(messages.errorKey), { richColors: true });
    return false;
  }
}
