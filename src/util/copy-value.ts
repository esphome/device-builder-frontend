import type { LocalizeFunc } from "../common/localize.js";
import { copyToClipboard } from "./copy-to-clipboard.js";
import { notify } from "./notify.js";

/** Toast strings for a copy control's outcome. */
export interface CopyToasts {
  okKey: string;
  failKey: string;
}

/** Copy *value* and toast the outcome. */
export async function copyWithToast(
  localize: LocalizeFunc,
  value: string,
  { okKey, failKey }: CopyToasts
): Promise<void> {
  if (await copyToClipboard(value)) {
    notify.success(localize(okKey));
  } else {
    notify.warning(localize(failKey));
  }
}
