// Shared scaffold for the logs-dialog test family. The mocks import
// comes first so the component tree below evaluates with them
// registered; test files import only this module.
import "./_logs-dialog-mocks.js";

import { ESPHomeLogsDialog } from "../../src/components/logs-dialog.js";
import { isStreaming, type LogsSession } from "../../src/components/logs-session.js";

export { toastError } from "./_logs-dialog-mocks.js";
// The one path to the component for the family: a direct value import
// in a test file would evaluate before this module registers the
// mocks whenever it sorts first.
export { ESPHomeLogsDialog } from "../../src/components/logs-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const session = (el: ESPHomeLogsDialog): LogsSession => (el as any)._session;
export const streaming = (el: ESPHomeLogsDialog): boolean => isStreaming(session(el));
export const paused = (el: ESPHomeLogsDialog): boolean => (el as any)._serialPaused;
export const call = (el: ESPHomeLogsDialog, method: string) => (el as any)[method]();
export const append = (el: ESPHomeLogsDialog, lines: string[]) =>
  (el as any)._log.append(lines);

/** Construct a dialog with a stubbed API (merged over the minimal
 *  default) and mount it unless the test drives it detached. */
export function makeLogsDialog(
  api: Record<string, unknown> = {},
  { mount = true }: { mount?: boolean } = {}
): ESPHomeLogsDialog {
  const el = new ESPHomeLogsDialog();
  (el as any)._api = {
    logs: () => "s1",
    stopStream: () => Promise.resolve(),
    ...api,
  };
  if (mount) document.body.appendChild(el);
  return el;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
