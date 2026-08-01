import { vi } from "vitest";

import type { BoardCatalogEntry } from "../../../src/api/types/boards.js";
import { ESPHomeAddComponentDialog } from "../../../src/components/device/add-component-dialog.js";

/**
 * A dialog wired to a stub API so the submit / bundle / detour paths run.
 *
 * Each suite supplies its own `Internals` type for `d`, because they
 * legitimately reach for different privates. Callers must still `vi.mock`
 * the form, the catalog and sonner-js at module scope: those run before
 * the import, so they can't live here.
 */
export function makeAddComponentDialogHost<I>(
  options: {
    yaml?: string;
    /** What the stubbed `addComponent` resolves to. */
    mergedYaml?: string;
    board?: BoardCatalogEntry | null;
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
  return {
    dialog,
    d: dialog as unknown as I,
    addComponent,
    getComponentBodies,
  };
}
