import toast from "sonner-js";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { LocalizeFunc } from "../common/localize.js";
import { refreshSecretKeys } from "./secrets-cache.js";
import { ensureSecretInYaml, setSecretInYaml } from "./secrets-write.js";

/**
 * Run a secrets.yaml write, refreshing the secret-keys cache on success and
 * toasting + returning false on failure so callers skip their follow-up.
 *
 * The refresh matters because the linked branch of ``ensureSecretInYaml``
 * doesn't fire ``secrets-saved``: without it an already-present key on a stale
 * cache would stay flagged "missing" after the user resolves it.
 */
async function writeWithToast(
  api: ESPHomeAPI,
  errorKey: string,
  logLabel: string,
  localize: LocalizeFunc,
  run: () => Promise<void>
): Promise<boolean> {
  try {
    await run();
    void refreshSecretKeys(api);
    return true;
  } catch (err) {
    console.error(logLabel, err);
    toast.error(localize(errorKey), { richColors: true });
    return false;
  }
}

/** Create ``key`` in secrets.yaml if absent (never clobbers), toasting the
 *  created / "linked" (already present) outcome. */
export function ensureSecretWithToast(
  api: ESPHomeAPI,
  key: string,
  value: string,
  localize: LocalizeFunc,
  messages: { createdKey: string; errorKey: string; logLabel: string }
): Promise<boolean> {
  return writeWithToast(api, messages.errorKey, messages.logLabel, localize, async () => {
    const { created } = await ensureSecretInYaml(api, key, value);
    toast[created ? "success" : "info"](
      localize(created ? messages.createdKey : "device.secret_picker_linked", { key }),
      { richColors: true }
    );
  });
}

/** Overwrite ``key``'s value in secrets.yaml, toasting on success. */
export function setSecretWithToast(
  api: ESPHomeAPI,
  key: string,
  value: string,
  localize: LocalizeFunc,
  messages: { savedKey: string; errorKey: string; logLabel: string }
): Promise<boolean> {
  return writeWithToast(api, messages.errorKey, messages.logLabel, localize, async () => {
    await setSecretInYaml(api, key, value);
    toast.success(localize(messages.savedKey, { key }), { richColors: true });
  });
}
