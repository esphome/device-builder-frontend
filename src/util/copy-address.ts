import type { LocalizeFunc } from "../common/localize.js";
import { copyToClipboard } from "./copy-to-clipboard.js";
import { notify } from "./notify.js";

/** Copy *value* and toast the outcome; shared by every address copy control. */
export async function copyAddressToClipboard(
  localize: LocalizeFunc,
  value: string
): Promise<void> {
  if (await copyToClipboard(value)) {
    notify.success(localize("settings.remote_build_address_copied"));
  } else {
    notify.warning(localize("settings.remote_build_address_copy_failed"));
  }
}
