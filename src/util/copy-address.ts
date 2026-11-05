import type { LocalizeFunc } from "../common/localize.js";
import { copyToClipboard } from "./copy-to-clipboard.js";
import { notify } from "./notify.js";

/** Copy *value* and toast the outcome with the *okKey* / *failKey* strings. */
export async function copyWithToast(
  localize: LocalizeFunc,
  value: string,
  okKey: string,
  failKey: string
): Promise<void> {
  if (await copyToClipboard(value)) {
    notify.success(localize(okKey));
  } else {
    notify.warning(localize(failKey));
  }
}

/** Copy *value* and toast the outcome; shared by every address copy control. */
export function copyAddressToClipboard(
  localize: LocalizeFunc,
  value: string
): Promise<void> {
  return copyWithToast(
    localize,
    value,
    "settings.remote_build_address_copied",
    "settings.remote_build_address_copy_failed"
  );
}
