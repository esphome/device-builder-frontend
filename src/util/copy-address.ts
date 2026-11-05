import type { LocalizeFunc } from "../common/localize.js";
import { copyWithToast } from "./copy-value.js";

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
