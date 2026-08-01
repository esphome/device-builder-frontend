import { vi } from "vitest";

import type { BoardCatalogEntry } from "../../../src/api/types/boards.js";
import { ESPHomeAddComponentDialog } from "../../../src/components/device/add-component-dialog.js";

/**
 * A dialog wired to a stub API so the submit / bundle / detour paths run.
 *
 * Suites type the returned `d` with their own `Internals`, since which
 * privates each one reaches for legitimately differs. Every caller must
 * still `vi.mock` the form, the catalog and sonner-js at module scope —
 * those have to run before the import and so can't live here.
 */
export function makeAddComponentDialogHost<I>(
  options: {
    yaml?: string;
    /** What the stubbed `addComponent` resolves to. */
    mergedYaml?: string;
    board?: BoardCatalogEntry | null;
    open?: boolean;
  } = {}
) {
  const addComponent = vi
    .fn()
    .mockResolvedValue({ yaml: options.mergedYaml ?? "MERGED" });
  const getComponentBodies = vi.fn().mockResolvedValue({});
  const dialog = new ESPHomeAddComponentDialog();
  Object.assign(dialog as unknown as Record<string, unknown>, {
    _api: { addComponent, getComponentBodies },
  });
  dialog.configuration = "foo.yaml";
  dialog.yaml = options.yaml ?? "esphome:\n  name: foo\n";
  if (options.board !== undefined) dialog.board = options.board;
  if (options.open) {
    (dialog as unknown as { _dialog: { open: boolean } })._dialog.open = true;
  }
  return {
    dialog,
    d: dialog as unknown as I,
    addComponent,
    getComponentBodies,
  };
}
