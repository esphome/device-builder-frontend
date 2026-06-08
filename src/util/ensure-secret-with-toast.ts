import toast from "sonner-js";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { LocalizeFunc } from "../common/localize.js";
import { refreshSecretKeys } from "./secrets-cache.js";
import { ensureSecretInYaml } from "./secrets-write.js";

/**
 * Write ``key: value`` to secrets.yaml (idempotent, never clobbers), toast the
 * outcome (``createdKey`` / shared "linked" / ``errorKey``), and on success
 * refresh the secret-keys cache. Returns false on failure so callers skip
 * their follow-up.
 *
 * The refresh matters on the linked branch: ``ensureSecretInYaml`` only fires
 * ``secrets-saved`` when it writes, so an already-present key on a stale cache
 * would otherwise stay flagged "missing" after the user resolves it.
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
    void refreshSecretKeys(api);
    return true;
  } catch (err) {
    console.error(messages.logLabel, err);
    toast.error(localize(messages.errorKey), { richColors: true });
    return false;
  }
}
