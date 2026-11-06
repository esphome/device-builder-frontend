import type { LocalizeFunc } from "../common/localize.js";
import { copyWithToast } from "./copy-value.js";

/** Toast keys for every address copy control. */
export const ADDRESS_COPY_TOASTS = {
  okKey: "settings.remote_build_address_copied",
  failKey: "settings.remote_build_address_copy_failed",
} as const;

/** Copy *value* and toast the outcome; shared by every address copy control. */
export function copyAddressToClipboard(
  localize: LocalizeFunc,
  value: string
): Promise<void> {
  return copyWithToast(
    localize,
    value,
    ADDRESS_COPY_TOASTS.okKey,
    ADDRESS_COPY_TOASTS.failKey
  );
}
